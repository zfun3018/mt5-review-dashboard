import unittest
import uuid
from unittest.mock import patch

from app import storage
from app.data.campaign_repository import CAMPAIGN_ID_NAMESPACE, CampaignRepository
from app.data.trade_repository import TradeRepository
from tests.support import TemporaryStorageCase, insert_trade


class TradeRepositoryQueryTest(TemporaryStorageCase):
    def _insert_many(self, count: int) -> None:
        with storage.db() as conn:
            conn.executemany(
                """
                INSERT INTO trades (
                    id, account, order_no, position_id, order_ticket, deal_ticket,
                    symbol, side, lots, open_time_utc, close_time_utc,
                    duration_seconds, entry_price, exit_price, pnl, commission,
                    swap, fee, screenshot_path, review_text, trade_type, strategy,
                    source, raw_json
                ) VALUES (?, 'ACC', ?, ?, ?, ?, 'XAUUSD', 'long', 1,
                          ?, ?, 60, 100, 101, 1, 0, 0, 0, '', '',
                          'follow', 'breakout', 'test', '{}')
                """,
                [
                    (
                        f"T-{index:03d}",
                        f"O-{index:03d}",
                        f"P-{index:03d}",
                        f"OT-{index:03d}",
                        f"D-{index:03d}",
                        f"2026-08-01T00:{index % 60:02d}:00+00:00",
                        f"2026-08-{1 + index // 60:02d}T00:{index % 60:02d}:00+00:00",
                    )
                    for index in range(count)
                ],
            )

    def test_page_two_is_fetched_in_sql_without_calling_list_trades(self):
        self._insert_many(125)

        with patch.object(storage, "list_trades", side_effect=AssertionError("full scan")):
            page = TradeRepository(storage.runtime_paths()).query({}, page=2, page_size=50)

        self.assertEqual(page.total, 125)
        self.assertEqual(page.page, 2)
        self.assertEqual(page.page_size, 50)
        self.assertEqual(len(page.items), 50)
        self.assertEqual(page.items[0]["id"], "T-074")
        self.assertEqual(page.items[-1]["id"], "T-025")

    def test_filters_use_exact_dimensions_beijing_boundaries_and_deleted_state(self):
        fixtures = (
            ("BEFORE", "XAUUSD", "long", "follow", "breakout", "2026-07-31T15:59:59+00:00", None),
            ("START", "XAUUSD", "long", "follow", "breakout", "2026-07-31T16:00:00+00:00", None),
            ("END", "XAUUSD", "long", "follow", "breakout", "2026-08-01T15:59:59+00:00", None),
            ("AFTER", "XAUUSD", "long", "follow", "breakout", "2026-08-01T16:00:00+00:00", None),
            ("SUFFIX", "XAUUSDc", "long", "follow", "breakout", "2026-08-01T00:00:00+00:00", None),
            ("SIDE", "XAUUSD", "short", "follow", "breakout", "2026-08-01T00:00:00+00:00", None),
            ("TYPE", "XAUUSD", "long", "reversal", "breakout", "2026-08-01T00:00:00+00:00", None),
            ("STRATEGY", "XAUUSD", "long", "follow", "range", "2026-08-01T00:00:00+00:00", None),
            ("DELETED", "XAUUSD", "long", "follow", "breakout", "2026-08-01T00:00:00+00:00", "2026-09-01"),
        )
        with storage.db() as conn:
            conn.executemany(
                """
                INSERT INTO trades (
                    id, account, order_no, position_id, order_ticket, deal_ticket,
                    symbol, side, lots, open_time_utc, close_time_utc,
                    duration_seconds, entry_price, exit_price, pnl, commission,
                    swap, fee, screenshot_path, review_text, trade_type, strategy,
                    deleted_at, source, raw_json
                ) VALUES (?, 'ACC', ?, ?, ?, ?, ?, ?, 1, ?, ?, 60, 100, 101,
                          1, 0, 0, 0, '', '', ?, ?, ?, 'test', '{}')
                """,
                [
                    (
                        trade_id,
                        trade_id,
                        trade_id,
                        trade_id,
                        trade_id,
                        symbol,
                        side,
                        closed_at,
                        closed_at,
                        trade_type,
                        strategy,
                        deleted_at,
                    )
                    for trade_id, symbol, side, trade_type, strategy, closed_at, deleted_at in fixtures
                ],
            )
        filters = {
            "symbol": "XAUUSD",
            "side": "long",
            "trade_type": "follow",
            "strategy": "breakout",
            "start_date": "2026-08-01",
            "end_date": "2026-08-01",
        }
        repository = TradeRepository(storage.runtime_paths())

        active = repository.query(filters, page=1, page_size=50)
        deleted = repository.query({**filters, "deleted": "deleted"}, page=1, page_size=50)
        all_rows = repository.query({**filters, "deleted": "all"}, page=1, page_size=50)

        self.assertEqual([item["id"] for item in active.items], ["END", "START"])
        self.assertEqual([item["id"] for item in deleted.items], ["DELETED"])
        self.assertEqual(all_rows.total, 3)

    def test_custom_values_are_attached_to_only_the_requested_page(self):
        self._insert_many(3)
        field = storage.create_custom_field({"name": "Synthetic", "field_type": "text"})
        for trade_id in ("T-000", "T-001", "T-002"):
            storage.update_trade_custom_value(trade_id, field["id"], {"value": trade_id})

        page = TradeRepository(storage.runtime_paths()).query({}, page=2, page_size=1)

        self.assertEqual(len(page.items), 1)
        self.assertEqual(page.items[0]["custom_fields"], {str(field["id"]): "T-001"})


class CampaignRepositoryReadTest(TemporaryStorageCase):
    def setUp(self):
        super().setUp()
        insert_trade(storage, id="CAMPAIGN-1", position_id="POSITION-1")

    def test_record_loading_does_not_change_the_connection(self):
        repository = CampaignRepository(storage.runtime_paths())
        with storage.db() as conn:
            before = conn.total_changes
            records = repository.records(conn=conn)
            after = conn.total_changes

        self.assertEqual(len(records), 1)
        self.assertEqual(after, before)

    def test_list_detail_and_analysis_do_not_rebuild_or_commit_writes(self):
        repository = CampaignRepository(storage.runtime_paths())
        campaign_id = repository.query({}, page=1, page_size=50).items[0]["id"]
        observer = storage.connect()
        try:
            before_version = observer.execute("PRAGMA data_version").fetchone()[0]
            with patch.object(CampaignRepository, "rebuild", autospec=True) as rebuild:
                listing = storage.list_campaigns()
                detail = storage.get_campaign(campaign_id)
                analysis = storage.get_analysis("2026-08-01", "2026-08-01")
            after_version = observer.execute("PRAGMA data_version").fetchone()[0]
        finally:
            observer.close()

        rebuild.assert_not_called()
        self.assertEqual(listing["total"], 1)
        self.assertEqual(detail["id"], campaign_id)
        self.assertEqual(analysis["metrics"]["order_count"], 1)
        self.assertEqual(after_version, before_version)

    def test_campaign_query_filters_and_paginates_in_sql(self):
        insert_trade(
            storage,
            id="CAMPAIGN-2",
            position_id="POSITION-2",
            symbol="XAUUSDc",
            close_time_utc="2026-08-01T01:00:00+00:00",
        )
        insert_trade(
            storage,
            id="CAMPAIGN-3",
            position_id="POSITION-3",
            symbol="XAUUSD",
            side="short",
            close_time_utc="2026-08-01T02:00:00+00:00",
        )
        repository = CampaignRepository(storage.runtime_paths())

        page = repository.query(
            {
                "symbol": "XAUUSD",
                "side": "long",
                "trade_type": "follow",
                "strategy": "breakout",
                "start_date": "2026-08-01",
                "end_date": "2026-08-01",
            },
            page=1,
            page_size=1,
        )

        self.assertEqual(page.total, 1)
        self.assertEqual(len(page.items), 1)
        self.assertEqual(page.items[0]["symbol"], "XAUUSD")

    def test_r_missing_filter_includes_direction_invalid_stops(self):
        repository = CampaignRepository(storage.runtime_paths())
        campaign = repository.query({}, page=1, page_size=50).items[0]
        position_id = campaign["positions"][0]["id"]
        with storage.db() as conn:
            conn.execute(
                "UPDATE positions SET initial_stop_price = 101 WHERE id = ?",
                (position_id,),
            )

        page = repository.query({"r_missing_only": True}, page=1, page_size=50)

        self.assertEqual(page.total, 1)
        self.assertEqual(page.items[0]["risk_status"], "invalid")

    def test_rebuild_claims_a_historical_campaign_id_for_only_one_split_descendant(self):
        with storage.db() as conn:
            conn.execute("DELETE FROM trades")
        deals = (
            ("P1-IN", "P1", "in", "buy", 100.0, "2026-08-01T00:00:00+00:00", 1000, 0.0),
            ("P2-IN", "P2", "in", "buy", 101.0, "2026-08-01T00:10:00+00:00", 2000, 0.0),
            ("P2-OUT", "P2", "out", "sell", 102.0, "2026-08-01T00:20:00+00:00", 3000, 1.0),
            ("P1-OUT", "P1", "out", "sell", 103.0, "2026-08-01T00:30:00+00:00", 4000, 3.0),
        )
        for ticket, position_id, entry_kind, deal_type, price, time_utc, time_msc, profit in deals:
            storage.ingest_mt5_event(
                {
                    "type": "deal",
                    "account": "ACC",
                    "deal_ticket": ticket,
                    "position_id": position_id,
                    "order_ticket": f"ORDER-{ticket}",
                    "entry_kind": entry_kind,
                    "deal_type": deal_type,
                    "symbol": "XAUUSD",
                    "volume": 1.0,
                    "price": price,
                    "time_utc": time_utc,
                    "time_msc": time_msc,
                    "profit": profit,
                }
            )
        repository = CampaignRepository(storage.runtime_paths())
        before = repository.query({}, page=1, page_size=50)
        prior_id = before.items[0]["id"]
        self.assertEqual(before.total, 1)

        with storage.db() as conn:
            conn.execute(
                "UPDATE deal_events SET time_utc = ?, time_msc = ? WHERE deal_ticket = 'P2-IN'",
                ("2026-08-01T00:40:00+00:00", 5000),
            )
            conn.execute(
                "UPDATE deal_events SET time_utc = ?, time_msc = ? WHERE deal_ticket = 'P2-OUT'",
                ("2026-08-01T00:50:00+00:00", 6000),
            )
        repository.rebuild()

        split = repository.query({}, page=1, page_size=50)
        memberships = {
            item["positions"][0]["position_id"]: item["id"] for item in split.items
        }
        first_ids = set(memberships.values())
        repository.rebuild()
        repeated_ids = {
            item["positions"][0]["position_id"]: item["id"]
            for item in repository.query({}, page=1, page_size=50).items
        }

        self.assertEqual(split.total, 2)
        self.assertEqual({item["position_count"] for item in split.items}, {1})
        self.assertEqual(len(first_ids), 2)
        self.assertIn(prior_id, first_ids)
        self.assertEqual(repeated_ids, memberships)

    def test_rebuild_probes_past_reserved_persisted_id_for_split_fallback(self):
        with storage.db() as conn:
            conn.execute("DELETE FROM trades")
        deals = (
            ("P1-IN", "P1", "in", "buy", 100.0, "2026-08-01T00:00:00+00:00", 1000, 0.0),
            ("P2-IN", "P2", "in", "buy", 101.0, "2026-08-01T00:10:00+00:00", 2000, 0.0),
            ("P2-OUT", "P2", "out", "sell", 102.0, "2026-08-01T00:20:00+00:00", 3000, 1.0),
            ("P1-OUT", "P1", "out", "sell", 103.0, "2026-08-01T00:30:00+00:00", 4000, 3.0),
        )
        for ticket, position_id, entry_kind, deal_type, price, time_utc, time_msc, profit in deals:
            storage.ingest_mt5_event(
                {
                    "type": "deal",
                    "account": "ACC",
                    "deal_ticket": ticket,
                    "position_id": position_id,
                    "order_ticket": f"ORDER-{ticket}",
                    "entry_kind": entry_kind,
                    "deal_type": deal_type,
                    "symbol": "XAUUSD",
                    "volume": 1.0,
                    "price": price,
                    "time_utc": time_utc,
                    "time_msc": time_msc,
                    "profit": profit,
                }
            )
        repository = CampaignRepository(storage.runtime_paths())
        self.assertEqual(repository.query({}, page=1, page_size=50).total, 1)

        collision_id = str(uuid.uuid5(CAMPAIGN_ID_NAMESPACE, "ACC:P2"))
        with storage.db() as conn:
            conn.execute(
                "UPDATE deal_events SET time_utc = ?, time_msc = ? WHERE deal_ticket = 'P2-IN'",
                ("2026-08-01T00:40:00+00:00", 5000),
            )
            conn.execute(
                "UPDATE deal_events SET time_utc = ?, time_msc = ? WHERE deal_ticket = 'P2-OUT'",
                ("2026-08-01T00:50:00+00:00", 6000),
            )
            conn.execute(
                """
                INSERT INTO trade_campaigns (
                    id, account, symbol, side, opened_at_utc, closed_at_utc,
                    status, net_pnl, review_text, trade_type, strategy,
                    screenshot_path, classification_conflict, deleted_at
                ) VALUES (?, 'ACC', 'XAUUSD', 'long', ?, ?, 'closed', 0,
                          'reserved review', 'follow', 'breakout', '', 0, ?)
                """,
                (
                    collision_id,
                    "2026-07-01T00:00:00+00:00",
                    "2026-07-01T00:10:00+00:00",
                    "2026-07-02T00:00:00+00:00",
                ),
            )

        repository.rebuild()
        split = repository.query({}, page=1, page_size=50)
        memberships = {
            item["positions"][0]["position_id"]: item["id"] for item in split.items
        }
        repository.rebuild()
        repeated = {
            item["positions"][0]["position_id"]: item["id"]
            for item in repository.query({}, page=1, page_size=50).items
        }
        with storage.db() as conn:
            reserved = conn.execute(
                "SELECT review_text, deleted_at FROM trade_campaigns WHERE id = ?",
                (collision_id,),
            ).fetchone()

        self.assertEqual(split.total, 2)
        self.assertNotEqual(memberships["P2"], collision_id)
        self.assertEqual(repeated, memberships)
        self.assertEqual(reserved["review_text"], "reserved review")
        self.assertEqual(reserved["deleted_at"], "2026-07-02T00:00:00+00:00")

    def test_r_missing_checks_every_entry_price_not_only_weighted_entry(self):
        with storage.db() as conn:
            conn.execute("DELETE FROM trades")
        deals = (
            ("SCALE-1", "in", "buy", 1.0, 100.0, 1000, 0.0),
            ("SCALE-2", "in", "buy", 1.0, 90.0, 2000, 0.0),
            ("SCALE-OUT", "out", "sell", 2.0, 110.0, 3000, 30.0),
        )
        for ticket, entry_kind, deal_type, volume, price, time_msc, profit in deals:
            storage.ingest_mt5_event(
                {
                    "type": "deal",
                    "account": "ACC",
                    "deal_ticket": ticket,
                    "position_id": "SCALE-POSITION",
                    "order_ticket": f"ORDER-{ticket}",
                    "entry_kind": entry_kind,
                    "deal_type": deal_type,
                    "symbol": "XAUUSD",
                    "volume": volume,
                    "price": price,
                    "time_utc": f"2026-08-01T00:{time_msc // 1000:02d}:00+00:00",
                    "time_msc": time_msc,
                    "profit": profit,
                }
            )
        repository = CampaignRepository(storage.runtime_paths())
        campaign = repository.query({}, page=1, page_size=50).items[0]
        with storage.db() as conn:
            conn.execute(
                "UPDATE positions SET initial_stop_price = 92 WHERE id = ?",
                (campaign["positions"][0]["id"],),
            )

        detail = repository.get(campaign["id"])
        page = repository.query({"r_missing_only": True}, page=1, page_size=50)

        self.assertEqual(detail["risk_status"], "invalid")
        self.assertEqual(page.total, 1)
        self.assertEqual(page.items[0]["risk_status"], detail["risk_status"])

    def test_r_missing_normalizes_whitespace_in_entry_kind_like_domain(self):
        with storage.db() as conn:
            conn.execute("DELETE FROM trades")
        deals = (
            ("PADDED-IN", " deal_entry_in ", "buy", 100.0, 1000, 0.0),
            ("PADDED-OUT", "out", "sell", 110.0, 2000, 10.0),
        )
        for ticket, entry_kind, deal_type, price, time_msc, profit in deals:
            storage.ingest_mt5_event(
                {
                    "type": "deal",
                    "account": "ACC",
                    "deal_ticket": ticket,
                    "position_id": "PADDED-POSITION",
                    "order_ticket": f"ORDER-{ticket}",
                    "entry_kind": entry_kind,
                    "deal_type": deal_type,
                    "symbol": "XAUUSD",
                    "volume": 1.0,
                    "price": price,
                    "time_utc": f"2026-08-01T00:{time_msc // 1000:02d}:00+00:00",
                    "time_msc": time_msc,
                    "profit": profit,
                }
            )
        repository = CampaignRepository(storage.runtime_paths())
        campaign = repository.query({}, page=1, page_size=50).items[0]
        with storage.db() as conn:
            conn.execute(
                "UPDATE positions SET initial_stop_price = 101 WHERE id = ?",
                (campaign["positions"][0]["id"],),
            )

        detail = repository.get(campaign["id"])
        page = repository.query({"r_missing_only": True}, page=1, page_size=50)

        self.assertEqual(detail["risk_status"], "invalid")
        self.assertEqual(page.total, 1)
        self.assertEqual(page.items[0]["risk_status"], detail["risk_status"])

    def test_r_missing_normalizes_control_and_unicode_whitespace_like_domain(self):
        with storage.db() as conn:
            conn.execute("DELETE FROM trades")
        cases = (
            ("CONTROL", "\t\nDEAL_ENTRY_IN\r\v\f", "XAUUSD", 0),
            ("UNICODE", "\u2003DEAL_ENTRY_IN\u2003", "EURUSD", 60000),
        )
        for label, entry_kind, symbol, offset in cases:
            for ticket, kind, deal_type, price, time_msc, profit in (
                (f"{label}-IN", entry_kind, "buy", 100.0, offset + 1000, 0.0),
                (f"{label}-OUT", "out", "sell", 110.0, offset + 2000, 10.0),
            ):
                storage.ingest_mt5_event(
                    {
                        "type": "deal",
                        "account": "ACC",
                        "deal_ticket": ticket,
                        "position_id": f"{label}-POSITION",
                        "order_ticket": f"ORDER-{ticket}",
                        "entry_kind": kind,
                        "deal_type": deal_type,
                        "symbol": symbol,
                        "volume": 1.0,
                        "price": price,
                        "time_utc": "2026-08-01T00:00:00+00:00",
                        "time_msc": time_msc,
                        "profit": profit,
                    }
                )

        repository = CampaignRepository(storage.runtime_paths())
        for label, _, symbol, _ in cases:
            with self.subTest(whitespace=label):
                campaign = repository.query(
                    {"symbol": symbol}, page=1, page_size=50
                ).items[0]
                with storage.db() as conn:
                    conn.execute(
                        "UPDATE positions SET initial_stop_price = 101 WHERE id = ?",
                        (campaign["positions"][0]["id"],),
                    )

                detail = repository.get(campaign["id"])
                page = repository.query(
                    {"symbol": symbol, "r_missing_only": True},
                    page=1,
                    page_size=50,
                )

                self.assertEqual(detail["risk_status"], "invalid")
                self.assertEqual(page.total, 1)
                self.assertEqual(page.items[0]["risk_status"], detail["risk_status"])

    def test_deleted_campaign_page_total_matches_materialized_items(self):
        repository = CampaignRepository(storage.runtime_paths())
        campaign_id = repository.query({}, page=1, page_size=50).items[0]["id"]
        with storage.db() as conn:
            conn.execute(
                "UPDATE trade_campaigns SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
                (campaign_id,),
            )

        active = repository.query({"deleted": "active"}, page=1, page_size=50)
        deleted = repository.query({"deleted": "deleted"}, page=1, page_size=50)
        all_rows = repository.query({"deleted": "all"}, page=1, page_size=50)

        self.assertEqual((active.total, len(active.items)), (0, 0))
        self.assertEqual((deleted.total, len(deleted.items)), (1, 1))
        self.assertEqual(deleted.items[0]["id"], campaign_id)
        self.assertEqual((all_rows.total, len(all_rows.items)), (1, 1))


if __name__ == "__main__":
    unittest.main()

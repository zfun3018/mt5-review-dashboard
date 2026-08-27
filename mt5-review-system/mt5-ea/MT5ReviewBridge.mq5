#property strict
#property version "1.000"
#property description "Local MT5 review bridge: trade events, M5 screenshots, local JSONL fallback."

input string InpBridgeUrl = "http://127.0.0.1:8787/api/mt5/events";
input bool InpSendHttp = true;
input bool InpWriteJsonl = true;
input int InpHttpTimeoutMs = 2500;
input int InpServerUtcOffsetHours = 0;
input int InpScreenshotWidth = 1280;
input int InpScreenshotHeight = 720;
input bool InpCaptureScreenshot = true;

int OnInit()
{
   FolderCreate("MT5ReviewBridge");
   FolderCreate("MT5ReviewBridge\\screenshots");
   EventSetTimer(60);
   Print("MT5ReviewBridge started. Allow WebRequest for: ", InpBridgeUrl);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   string json = StringFormat(
      "{\"type\":\"equity_snapshot\",\"account\":\"%I64d\",\"time_utc\":\"%s\",\"balance\":%s,\"equity\":%s}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      IsoUtc(TimeGMT()),
      DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2),
      DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2)
   );
   Publish(json);
}

void OnTradeTransaction(
   const MqlTradeTransaction &trans,
   const MqlTradeRequest &request,
   const MqlTradeResult &result
)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;

   if(!HistoryDealSelect(trans.deal))
      return;

   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   string symbol = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   long positionId = HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   long dealType = HistoryDealGetInteger(trans.deal, DEAL_TYPE);
   datetime dealServerTime = (datetime)HistoryDealGetInteger(trans.deal, DEAL_TIME);
   long dealTimeMsc = HistoryDealGetInteger(trans.deal, DEAL_TIME_MSC);
   double dealPrice = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
   double volume = HistoryDealGetDouble(trans.deal, DEAL_VOLUME);
   double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT);
   double commission = HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
   double swap = HistoryDealGetDouble(trans.deal, DEAL_SWAP);
   double fee = HistoryDealGetDouble(trans.deal, DEAL_FEE);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   bool isExit = (entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_INOUT || entry == DEAL_ENTRY_OUT_BY);

   string shot = "";
   if(isExit && InpCaptureScreenshot)
      shot = CaptureM5Screenshot(symbol, positionId, trans.deal);

   string dealJson = StringFormat(
      "{\"type\":\"deal\",\"account\":\"%I64d\",\"deal_ticket\":\"%I64d\",\"position_id\":\"%I64d\",\"order_ticket\":\"%I64d\",\"entry_kind\":\"%s\",\"deal_type\":\"%s\",\"symbol\":\"%s\",\"volume\":%s,\"price\":%s,\"time_utc\":\"%s\",\"time_msc\":%I64d,\"profit\":%s,\"commission\":%s,\"swap\":%s,\"fee\":%s,\"screenshot_path\":\"%s\"}",
      AccountInfoInteger(ACCOUNT_LOGIN),
      trans.deal,
      positionId,
      trans.order,
      DealEntryName(entry),
      DealTypeName(dealType),
      JsonEscape(symbol),
      DoubleToString(volume, 2),
      DoubleToString(dealPrice, digits),
      IsoUtc(ServerToUtc(dealServerTime)),
      dealTimeMsc - (long)InpServerUtcOffsetHours * 3600000,
      DoubleToString(profit, 2),
      DoubleToString(commission, 2),
      DoubleToString(swap, 2),
      DoubleToString(fee, 2),
      JsonEscape(shot)
   );
   Publish(dealJson);

   if(!isExit)
      return;

   datetime openServerTime = dealServerTime;
   double openPrice = dealPrice;
   string side = "long";
   ulong openingDeal = 0;
   FindOpeningDeal(positionId, openServerTime, openPrice, side, openingDeal);

   string tradeId = StringFormat("%I64d-%I64d", positionId, trans.deal);
   string json = StringFormat(
      "{\"type\":\"trade_close\",\"trade_id\":\"%s\",\"account\":\"%I64d\",\"order_no\":\"%I64d\",\"position_id\":\"%I64d\",\"order_ticket\":\"%I64d\",\"deal_ticket\":\"%I64d\",\"symbol\":\"%s\",\"side\":\"%s\",\"lots\":%s,\"open_time_utc\":\"%s\",\"close_time_utc\":\"%s\",\"entry_price\":%s,\"exit_price\":%s,\"pnl\":%s,\"commission\":%s,\"swap\":%s,\"screenshot_path\":\"%s\"}",
      JsonEscape(tradeId),
      AccountInfoInteger(ACCOUNT_LOGIN),
      trans.order,
      positionId,
      trans.order,
      trans.deal,
      JsonEscape(symbol),
      side,
      DoubleToString(volume, 2),
      IsoUtc(ServerToUtc(openServerTime)),
      IsoUtc(ServerToUtc(dealServerTime)),
      DoubleToString(openPrice, digits),
      DoubleToString(dealPrice, digits),
      DoubleToString(profit, 2),
      DoubleToString(commission, 2),
      DoubleToString(swap, 2),
      JsonEscape(shot)
   );

   Publish(json);
}

string DealEntryName(long entry)
{
   if(entry == DEAL_ENTRY_IN)
      return "in";
   if(entry == DEAL_ENTRY_OUT)
      return "out";
   if(entry == DEAL_ENTRY_INOUT)
      return "inout";
   if(entry == DEAL_ENTRY_OUT_BY)
      return "out_by";
   return "unknown";
}

string DealTypeName(long dealType)
{
   if(dealType == DEAL_TYPE_BUY)
      return "buy";
   if(dealType == DEAL_TYPE_SELL)
      return "sell";
   return "other";
}

void FindOpeningDeal(
   long positionId,
   datetime &openTime,
   double &openPrice,
   string &side,
   ulong &openingDeal
)
{
   if(!HistorySelect(0, TimeCurrent()))
      return;

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0)
         continue;
      if((long)HistoryDealGetInteger(ticket, DEAL_POSITION_ID) != positionId)
         continue;
      long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_IN && entry != DEAL_ENTRY_INOUT)
         continue;

      openingDeal = ticket;
      openTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      openPrice = HistoryDealGetDouble(ticket, DEAL_PRICE);
      long dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
      side = (dealType == DEAL_TYPE_SELL) ? "short" : "long";
      return;
   }
}

string CaptureM5Screenshot(string symbol, long positionId, ulong dealTicket)
{
   long chartId = ChartOpen(symbol, PERIOD_M5);
   if(chartId == 0)
   {
      Print("ChartOpen failed for ", symbol, ". Error: ", GetLastError());
      return "";
   }

   MqlRates rates[];
   for(int i = 0; i < 20; i++)
   {
      int copied = CopyRates(symbol, PERIOD_M5, 0, 200, rates);
      if(copied > 20)
         break;
      Sleep(250);
   }

   ChartSetInteger(chartId, CHART_AUTOSCROLL, true);
   ChartSetInteger(chartId, CHART_SHIFT, true);
   ChartSetInteger(chartId, CHART_SCALEFIX, false);
   ChartSetInteger(chartId, CHART_SHOW_GRID, true);
   ChartNavigate(chartId, CHART_END, 0);
   ChartRedraw(chartId);
   Sleep(1500);

   string filename = StringFormat(
      "MT5ReviewBridge\\screenshots\\%s_%I64d_%I64d_M5.png",
      symbol,
      positionId,
      dealTicket
   );
   bool ok = ChartScreenShot(chartId, filename, InpScreenshotWidth, InpScreenshotHeight, ALIGN_RIGHT);
   ChartClose(chartId);

   if(!ok)
   {
      Print("ChartScreenShot failed. Error: ", GetLastError());
      return "";
   }
   return StringFormat("screenshots/%s_%I64d_%I64d_M5.png", symbol, positionId, dealTicket);
}

void Publish(string json)
{
   if(InpWriteJsonl)
      WriteJsonl(json);
   if(InpSendHttp)
      SendHttp(json);
}

void WriteJsonl(string json)
{
   string filename = "MT5ReviewBridge\\events_" + DateStamp(TimeGMT()) + ".jsonl";
   int handle = FileOpen(filename, FILE_READ | FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_SHARE_READ);
   if(handle == INVALID_HANDLE)
   {
      Print("FileOpen failed. Error: ", GetLastError());
      return;
   }
   FileSeek(handle, 0, SEEK_END);
   FileWriteString(handle, json + "\r\n");
   FileClose(handle);
}

void SendHttp(string json)
{
   char data[];
   char response[];
   string responseHeaders;
   StringToCharArray(json, data, 0, StringLen(json), CP_UTF8);
   int status = WebRequest(
      "POST",
      InpBridgeUrl,
      "Content-Type: application/json\r\n",
      InpHttpTimeoutMs,
      data,
      response,
      responseHeaders
   );
   if(status == -1)
      Print("WebRequest failed. Add the URL in MT5 options. Error: ", GetLastError());
}

datetime ServerToUtc(datetime serverTime)
{
   return serverTime - InpServerUtcOffsetHours * 3600;
}

string IsoUtc(datetime value)
{
   MqlDateTime dt;
   TimeToStruct(value, dt);
   return StringFormat(
      "%04d-%02d-%02dT%02d:%02d:%02d+00:00",
      dt.year,
      dt.mon,
      dt.day,
      dt.hour,
      dt.min,
      dt.sec
   );
}

string DateStamp(datetime value)
{
   MqlDateTime dt;
   TimeToStruct(value, dt);
   return StringFormat("%04d%02d%02d", dt.year, dt.mon, dt.day);
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "\\r");
   StringReplace(value, "\n", "\\n");
   return value;
}

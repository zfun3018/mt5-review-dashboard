function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    defaultSize: Object.freeze({...definition.defaultSize}),
    defaultSettings: Object.freeze({...definition.defaultSettings}),
  });
}
export function createModuleRegistry(initialDefinitions = []) {
  const definitions = new Map();

  function register(definition) {
    if (!definition?.type || !definition?.title || !definition?.defaultSize) {
      throw new TypeError("Module definition requires type, title, and defaultSize");
    }
    if (definitions.has(definition.type)) {
      throw new Error(`Module type already registered: ${definition.type}`);
    }
    const frozen = freezeDefinition(definition);
    definitions.set(frozen.type, frozen);
    return frozen;
  }

  initialDefinitions.forEach(register);

  return Object.freeze({
    register,
    get(type) {
      return definitions.get(type) || null;
    },
    has(type) {
      return definitions.has(type);
    },
    list() {
      return [...definitions.values()];
    },
    asMap() {
      return new Map(definitions);
    },
  });
}

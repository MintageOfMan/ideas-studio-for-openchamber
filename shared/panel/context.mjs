// Keep the host's AI selection separate from Studio's optional model override.
// A repeated theme snapshot is not a new chat, but a new model is a new connection.
export function hostContext(snapshot, hostOrigin) {
  // SDK SessionSnapshot.model is a provider/model string, not OpenCode's Model.Ref.
  // Do not turn a display-only label into a made-up model; the service can read the session.
  const value = snapshot.session?.model;
  let model;
  if (typeof value === 'string') {
    const slash = value.indexOf('/');
    if (slash > 0 && slash < value.length - 1) {
      const [id, variant] = value.slice(slash + 1).split('#');
      model = { providerID: value.slice(0, slash), id, ...(variant ? { variant } : {}) };
    }
  } else if (value?.providerID && value?.id) model = value;
  return {
    directory: snapshot.directory ?? null,
    sessionId: snapshot.session?.id ?? '',
    hostOrigin,
    ...(model ? { model } : {}),
    ...(snapshot.session?.agent ? { agent: snapshot.session.agent } : {}),
  };
}

export function contextQuery(context, extra = {}) {
  const query = new URLSearchParams({
    directory: context?.directory ?? '', sessionId: context?.sessionId ?? '',
    hostOrigin: context?.hostOrigin ?? '', ...extra,
  });
  if (context?.model) query.set('model', JSON.stringify(context.model));
  if (context?.agent) query.set('agent', context.agent);
  if (context?.agentOverride) query.set('agentOverride', context.agentOverride);
  if (context?.modelOverride) query.set('modelOverride', JSON.stringify(context.modelOverride));
  return query.toString();
}

export function chosenModel(connection, preference = 'auto') {
  if (connection?.ready === false) return null;
  const models = connection?.models ?? [];
  const explicit = preference !== 'auto' && models.find((model) => model.key === preference);
  return explicit || models.find((model) => model.key === connection?.defaultModelKey)
    || models.find((model) => model.key === connection?.selectedModelKey) || null;
}

export function modelFromKey(value) {
  try {
    const parts = JSON.parse(value);
    if (!Array.isArray(parts) || parts.length !== 3 || !parts.every(part => typeof part === 'string') || !parts[0] || !parts[1]) return null;
    return { providerID: parts[0], id: parts[1], ...(parts[2] ? { variant: parts[2] } : {}) };
  } catch { return null; }
}

export function selectionContext(context, agent = 'auto', model = 'auto') {
  const { agentOverride: previousAgent, modelOverride: previousModel, ...next } = context ?? {};
  if (agent !== 'auto') next.agentOverride = agent;
  if (model !== 'auto') next.modelOverride = modelFromKey(model);
  return next;
}

export function canCreate(connection, preference = 'auto') {
  return connection?.ready === true && Boolean(connection.agents?.some(agent => agent.id === connection.agent))
    && Boolean(chosenModel(connection, preference));
}

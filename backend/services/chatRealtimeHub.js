const createChatRealtimeHub = () => {
  const subscribers = new Map();

  const subscribe = (userId, response) => {
    const key = Number(userId);
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    const subscription = { response };
    subscribers.get(key).add(subscription);
    return () => {
      const current = subscribers.get(key);
      current?.delete(subscription);
      if (current?.size === 0) subscribers.delete(key);
    };
  };

  const publishToUsers = (userIds, event, payload) => {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const userId of new Set((userIds || []).map(Number).filter(Boolean))) {
      for (const subscription of subscribers.get(userId) || []) {
        try { subscription.response.write(data); } catch { /* la desconexión limpiará la suscripción */ }
      }
    }
  };

  const heartbeat = () => {
    for (const group of subscribers.values()) {
      for (const subscription of group) {
        try { subscription.response.write(': keep-alive\n\n'); } catch { /* se limpia al cerrar */ }
      }
    }
  };

  const timer = setInterval(heartbeat, 25_000);
  timer.unref?.();

  return {
    subscribe,
    publishToUsers,
    close: () => {
      clearInterval(timer);
      for (const group of subscribers.values()) {
        for (const subscription of group) subscription.response.end();
      }
      subscribers.clear();
    }
  };
};

module.exports = { createChatRealtimeHub };

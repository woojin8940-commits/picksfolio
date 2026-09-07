type Message = { id: string; clientId?: string; createdAt: string };

export function mergeTimelineMessages<T extends Message>(server: T[], local: T[]): T[] {
  const ids = new Set(server.map(message => message.id));
  const clientIds = new Set(server.map(message => message.clientId).filter(Boolean));
  const pending = local.filter(message =>
    (message.id.startsWith('pending_') || message.id.startsWith('failed_')) &&
    !ids.has(message.id) && !clientIds.has(message.clientId || message.id),
  );
  return [...server, ...pending];
}

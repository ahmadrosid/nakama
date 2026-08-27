const VISIBLE_JID_SUFFIX_LENGTH = 4;

export function maskWhatsAppJid(jid: string | null | undefined): string {
  const trimmed = jid?.trim();

  if (!trimmed) {
    return "-";
  }

  const [address = "", server] = trimmed.split("@", 2);
  const [account = "", device] = address.split(":", 2);
  const visibleSuffix =
    account.length > VISIBLE_JID_SUFFIX_LENGTH
      ? account.slice(-VISIBLE_JID_SUFFIX_LENGTH)
      : "";
  const deviceSuffix = device ? `:${device}` : "";
  const serverSuffix = server ? `@${server}` : "";

  return `***${visibleSuffix}${deviceSuffix}${serverSuffix}`;
}

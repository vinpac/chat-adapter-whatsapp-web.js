import type { Client } from "whatsapp-web.js";
import { WhatsAppAdapter } from "./whatsapp-adapter";

export { WhatsAppAdapter } from "./whatsapp-adapter";

export function createWhatsAppAdapter(
  client: Client,
  userName?: string
): WhatsAppAdapter {
  return new WhatsAppAdapter(client, userName);
}

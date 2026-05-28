const BOT_TOKEN = "8750867113:AAEh65DpXnNqhGFPx3hoBNw1PfEN7ZQWhrI";
const CHAT_ID = "7474049767";
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

export async function sendTelegramNotification(text: string): Promise<void> {
  try {
    const res = await fetch(TELEGRAM_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn("[telegram] Failed to send notification:", err);
    }
  } catch (err) {
    console.warn("[telegram] Error sending notification:", err);
  }
}

export function parseDeviceName(userAgent: string): string {
  if (!userAgent) return "Unknown Device";

  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) {
    const match = userAgent.match(/Android[^;]*;\s*([^)]+)/);
    if (match) return match[1].trim();
    return "Android Device";
  }
  if (/Windows NT 10/i.test(userAgent)) return "Windows 10/11 PC";
  if (/Windows NT 6\.3/i.test(userAgent)) return "Windows 8.1 PC";
  if (/Windows NT 6\.1/i.test(userAgent)) return "Windows 7 PC";
  if (/Windows/i.test(userAgent)) return "Windows PC";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "Mac";
  if (/Linux/i.test(userAgent)) return "Linux PC";
  if (/CrOS/i.test(userAgent)) return "Chromebook";

  return "Unknown Device";
}

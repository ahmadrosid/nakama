import type { Sql } from "postgres";
export interface TelegramManagerOptions {
    managerToken: string | undefined;
    sql: Sql;
    webhookSecret: string | undefined;
}
export declare function handleTelegramPairing(request: Request, options: TelegramManagerOptions): Promise<Response>;
export declare function handleTelegramWebhook(request: Request, options: TelegramManagerOptions): Promise<Response>;

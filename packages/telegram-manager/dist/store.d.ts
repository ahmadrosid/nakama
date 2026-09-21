import type { Sql } from "postgres";
interface Pairing {
    bot_id: string | null;
    bot_username: string | null;
    expires_at: Date;
    id: string;
    owner_user_id: string | null;
    secret_hash: string;
    suggested_username: string;
}
export declare function createTelegramPairing(sql: Sql, pairing: {
    id: string;
    secretHash: string;
    suggestedUsername: string;
    expiresAt: Date;
}): Promise<boolean>;
export declare function getTelegramPairing(sql: Sql, id: string, secretHash: string): Promise<Pairing>;
export declare function deleteTelegramPairing(sql: Sql, id: string, secretHash: string): Promise<void>;
export declare function bindTelegramPairing(sql: Sql, id: string, ownerUserId: string): Promise<Pairing>;
export declare function completeTelegramPairing(sql: Sql, bot: {
    id: string;
    username: string;
    ownerUserId: string;
}): Promise<void>;
export {};

/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { classNameFactory } from "@api/Styles";
import { Message } from "@vencord/discord-types";
import { Parser, useEffect, useState } from "@webpack/common";

import { ENCRYPTED_PREFIX, KEY_ANNOUNCE_PREFIX } from "./constants";
import { decryptText, getFingerprint } from "./crypto";
import { getIdentityForChannel, getPeerKey } from "./store";
import { getDMRecipientId, isOwnMessageAuthor } from "./utils";

const cl = classNameFactory("vc-gpg-");

type State =
    | { status: "loading"; }
    | { status: "error"; error: string; }
    | { status: "decrypted"; text: string; verified: boolean; }
    | { status: "key-announcement"; fingerprint: string; };

async function resolve(message: Message): Promise<State> {
    const { content } = message;

    if (content.startsWith(KEY_ANNOUNCE_PREFIX)) {
        const armored = content.slice(KEY_ANNOUNCE_PREFIX.length).trim();
        try {
            const fingerprint = await getFingerprint(armored);
            return { status: "key-announcement", fingerprint };
        } catch {
            return { status: "error", error: "This does not look like a valid GPG public key." };
        }
    }

    const armored = content.slice(ENCRYPTED_PREFIX.length).trim();
    const ownMessage = isOwnMessageAuthor(message.author.id);
    const peerId = ownMessage ? getDMRecipientId(message.channel_id) : message.author.id;
    const peerKey = peerId ? getPeerKey(peerId) : undefined;
    const identity = getIdentityForChannel(message.channel_id);

    try {
        const { text, signatureVerified } = await decryptText(armored, identity.privateKey, peerKey?.publicKey);
        return { status: "decrypted", text, verified: signatureVerified };
    } catch (e: any) {
        return { status: "error", error: e?.message ?? "Failed to decrypt this message." };
    }
}

export function GpgMessageAccessory({ message }: { message: Message; }) {
    const [state, setState] = useState<State>({ status: "loading" });

    useEffect(() => {
        let cancelled = false;
        resolve(message).then(result => {
            if (!cancelled) setState(result);
        });
        return () => { cancelled = true; };
    }, [message.id, message.content]);

    if (state.status === "loading") {
        return <span className={cl("accessory", "loading")}>Decrypting…</span>;
    }

    if (state.status === "error") {
        return <span className={cl("accessory", "error")}>🔒 {state.error}</span>;
    }

    if (state.status === "key-announcement") {
        return (
            <span className={cl("accessory", "key")}>
                🔑 GPG public key ({state.fingerprint.slice(-8)}) — encryption will be used automatically from now on.
            </span>
        );
    }

    return (
        <span className={cl("accessory", "decrypted")}>
            🔓 {Parser.parse(state.text)}
            {state.verified && <span className={cl("verified")}> (signature verified)</span>}
        </span>
    );
}

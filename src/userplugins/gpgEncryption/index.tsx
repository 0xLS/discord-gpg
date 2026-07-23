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

import "./styles.css";

import { ApplicationCommandInputType, sendBotMessage } from "@api/Commands";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { ChannelStore, FluxDispatcher, UserStore } from "@webpack/common";

import { GpgMessageAccessory } from "./components";
import { ENCRYPTED_PREFIX, KEY_ANNOUNCE_PREFIX } from "./constants";
import { encryptText, getFingerprint } from "./crypto";
import * as store from "./store";
import { isOneOnOneDMChannel, isOwnMessageAuthor } from "./utils";

const logger = new Logger("GpgEncryption");

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Automatically encrypt & decrypt DM messages once a public key has been exchanged with the other person",
        default: true
    }
});

async function announcePublicKey(channelId: string, recipientId: string) {
    const identity = store.getIdentityForChannel(channelId);
    await sendMessage(channelId, { content: `${KEY_ANNOUNCE_PREFIX}\n${identity.publicKey}` });
    await store.markAnnouncedTo(recipientId);
}

async function handleIncomingKeyAnnouncement(channelId: string, authorId: string, armoredPublicKey: string) {
    try {
        const fingerprint = await getFingerprint(armoredPublicKey);
        // Always cache a peer's key when we see one, even if encryption isn't
        // enabled on our side yet for this chat — this is just local storage,
        // it doesn't send anything or turn encryption on by itself. Without
        // this, enabling encryption later would have no way to recover a key
        // that was announced to us while we had this chat toggled off.
        await store.setPeerKey(authorId, { publicKey: armoredPublicKey, fingerprint });

        // Only reciprocate (send our own key back) if we've actually opted
        // this chat into encryption ourselves.
        if (store.isChannelEnabled(channelId) && !store.hasAnnouncedTo(authorId)) {
            await announcePublicKey(channelId, authorId);
        }
    } catch (e) {
        logger.error("Failed to import a peer's public key", e);
    }
}

function onMessageCreate({ message }: { message: Message; }) {
    if (!settings.store.enabled) return;
    if (!message?.content || message.author?.bot) return;
    if (isOwnMessageAuthor(message.author.id)) return;
    if (!message.content.startsWith(KEY_ANNOUNCE_PREFIX)) return;

    const channel = ChannelStore.getChannel(message.channel_id);
    if (!isOneOnOneDMChannel(channel)) return;

    const armoredPublicKey = message.content.slice(KEY_ANNOUNCE_PREFIX.length).trim();
    handleIncomingKeyAnnouncement(message.channel_id, message.author.id, armoredPublicKey);
}

export default definePlugin({
    name: "GpgEncryption",
    description: "Automatically encrypts & decrypts DM messages using GPG (OpenPGP), with automatic in-chat key exchange",
    authors: [{ name: "you", id: 0n }],
    settings,

    async start() {
        const me = UserStore.getCurrentUser();
        await store.init(`Vencord GPG Encryption <${me?.id ?? "unknown"}>`);
        FluxDispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
    },

    renderMessageAccessory: props => {
        const { content } = props.message;
        if (!content?.startsWith(ENCRYPTED_PREFIX) && !content?.startsWith(KEY_ANNOUNCE_PREFIX)) return null;
        return <GpgMessageAccessory message={props.message} />;
    },

    async onBeforeMessageSend(channelId, message) {
        if (!settings.store.enabled) return;
        if (!message.content) return;
        if (message.content.startsWith(ENCRYPTED_PREFIX) || message.content.startsWith(KEY_ANNOUNCE_PREFIX)) return;
        if (!store.isChannelEnabled(channelId)) return;

        const channel = ChannelStore.getChannel(channelId);
        if (!isOneOnOneDMChannel(channel)) return;

        const recipientId = channel.recipients[0];
        const peerKey = store.getPeerKey(recipientId);

        if (!peerKey) {
            if (!store.hasAnnouncedTo(recipientId)) {
                await announcePublicKey(channelId, recipientId);
            }
            return;
        }

        const identity = store.getIdentityForChannel(channelId);
        try {
            const encrypted = await encryptText(message.content, [peerKey.publicKey, identity.publicKey], identity.privateKey);
            message.content = `${ENCRYPTED_PREFIX}\n${encrypted}`;
        } catch (e) {
            logger.error("Failed to encrypt outgoing message, sending as plaintext", e);
        }
    },

    commands: [
        {
            name: "gpg-share-key",
            description: "(Re)send your GPG public key to this DM and enable encryption here",
            inputType: ApplicationCommandInputType.BUILT_IN,
            async execute(_, ctx) {
                const { channel } = ctx;
                if (!isOneOnOneDMChannel(channel)) {
                    return void sendBotMessage(ctx.channel.id, { content: "This only works in a 1:1 DM." });
                }
                await store.setChannelEnabled(channel.id, true);
                await announcePublicKey(channel.id, channel.recipients[0]);
                sendBotMessage(ctx.channel.id, { content: "Sent your GPG public key to this chat and enabled encryption here." });
            }
        },
        {
            name: "gpg-new-chat-key",
            description: "Generate a GPG keypair unique to this DM and enable encryption here",
            inputType: ApplicationCommandInputType.BUILT_IN,
            async execute(_, ctx) {
                const { channel } = ctx;
                if (!isOneOnOneDMChannel(channel)) {
                    return void sendBotMessage(ctx.channel.id, { content: "This only works in a 1:1 DM." });
                }
                const recipientId = channel.recipients[0];
                const keyPair = await store.setChannelIdentity(channel.id, `Vencord GPG Encryption <chat:${channel.id}>`);
                await store.forgetAnnouncedTo(recipientId);
                await store.setChannelEnabled(channel.id, true);
                await announcePublicKey(channel.id, recipientId);
                sendBotMessage(ctx.channel.id, { content: `Generated a new key for this chat (fingerprint ${keyPair.fingerprint}), shared it, and enabled encryption here.` });
            }
        },
        {
            name: "gpg-use-shared-key",
            description: "Use your shared identity key here (instead of a per-chat key) and enable encryption",
            inputType: ApplicationCommandInputType.BUILT_IN,
            async execute(_, ctx) {
                const { channel } = ctx;
                if (!isOneOnOneDMChannel(channel)) {
                    return void sendBotMessage(ctx.channel.id, { content: "This only works in a 1:1 DM." });
                }
                const recipientId = channel.recipients[0];
                if (store.hasChannelOverride(channel.id)) {
                    await store.clearChannelIdentity(channel.id);
                    await store.forgetAnnouncedTo(recipientId);
                }
                await store.setChannelEnabled(channel.id, true);
                await announcePublicKey(channel.id, recipientId);
                sendBotMessage(ctx.channel.id, { content: "Using your shared identity key here, shared it, and enabled encryption for this chat." });
            }
        },
        {
            name: "gpg-toggle",
            description: "Enable/disable automatic GPG encryption for this specific DM",
            inputType: ApplicationCommandInputType.BUILT_IN,
            async execute(_, ctx) {
                const { channel } = ctx;
                if (!isOneOnOneDMChannel(channel)) {
                    return void sendBotMessage(ctx.channel.id, { content: "This only works in a 1:1 DM." });
                }
                const recipientId = channel.recipients[0];
                const enabling = !store.isChannelEnabled(channel.id);
                await store.setChannelEnabled(channel.id, enabling);

                if (enabling && !store.hasAnnouncedTo(recipientId)) {
                    await announcePublicKey(channel.id, recipientId);
                }

                sendBotMessage(ctx.channel.id, {
                    content: enabling
                        ? "GPG encryption is now **enabled** for this chat."
                        : "GPG encryption is now **disabled** for this chat. Messages will be sent as plaintext."
                });
            }
        },
        {
            name: "gpg-status",
            description: "Show GPG encryption status for this DM",
            inputType: ApplicationCommandInputType.BUILT_IN,
            async execute(_, ctx) {
                const { channel } = ctx;
                if (!isOneOnOneDMChannel(channel)) {
                    return void sendBotMessage(ctx.channel.id, { content: "This only works in a 1:1 DM." });
                }
                const recipientId = channel.recipients[0];
                const identity = store.getIdentityForChannel(channel.id);
                const peerKey = store.getPeerKey(recipientId);
                const usingChatKey = store.hasChannelOverride(channel.id);

                const lines = [
                    `Encryption: **${settings.store.enabled && store.isChannelEnabled(channel.id) ? "enabled" : "disabled"}** for this chat`,
                    `Your key for this chat: \`${identity.fingerprint}\` (${usingChatKey ? "per-chat key" : "shared identity key"})`,
                    peerKey
                        ? `Their key: \`${peerKey.fingerprint}\``
                        : "Their key: none yet — enable encryption to trigger the automatic key exchange."
                ];
                sendBotMessage(ctx.channel.id, { content: lines.join("\n") });
            }
        },
        {
            name: "gpg-delete-all",
            description: "Wipe ALL locally stored GPG keys (your identity, per-chat keys, and every contact's key) — irreversible",
            inputType: ApplicationCommandInputType.BUILT_IN,
            async execute(_, ctx) {
                const me = UserStore.getCurrentUser();
                await store.wipeAll(`Vencord GPG Encryption <${me?.id ?? "unknown"}>`);
                sendBotMessage(ctx.channel.id, {
                    content: "Deleted all stored GPG keys and generated a fresh identity. Encryption is disabled for every chat again until you re-enable it — you will need to re-exchange keys with everyone."
                });
            }
        }
    ]
});

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

import * as DataStore from "@api/DataStore";

import {
    DATA_KEY_ANNOUNCED_TO,
    DATA_KEY_CHANNEL_IDENTITIES,
    DATA_KEY_DISABLED_CHANNELS,
    DATA_KEY_IDENTITY,
    DATA_KEY_PEER_KEYS
} from "./constants";
import { generateIdentity, KeyPair } from "./crypto";

export interface PeerKey {
    publicKey: string;
    fingerprint: string;
}

let identity: KeyPair | undefined;
let channelIdentities: Record<string, KeyPair> = {};
let peerKeys: Record<string, PeerKey> = {};
let announcedTo: string[] = [];
let disabledChannels: string[] = [];

export async function init(defaultIdentityLabel: string) {
    [identity, channelIdentities, peerKeys, announcedTo, disabledChannels] = await Promise.all([
        DataStore.get<KeyPair>(DATA_KEY_IDENTITY),
        DataStore.get<Record<string, KeyPair>>(DATA_KEY_CHANNEL_IDENTITIES),
        DataStore.get<Record<string, PeerKey>>(DATA_KEY_PEER_KEYS),
        DataStore.get<string[]>(DATA_KEY_ANNOUNCED_TO),
        DataStore.get<string[]>(DATA_KEY_DISABLED_CHANNELS)
    ]).then(([id, ci, pk, at, dc]) => [id, ci ?? {}, pk ?? {}, at ?? [], dc ?? []] as const);

    if (!identity) {
        identity = await generateIdentity(defaultIdentityLabel);
        await DataStore.set(DATA_KEY_IDENTITY, identity);
    }
}

export function getIdentity(): KeyPair {
    if (!identity) throw new Error("GpgEncryption store used before init()");
    return identity;
}

export async function regenerateIdentity(label: string): Promise<KeyPair> {
    identity = await generateIdentity(label);
    await DataStore.set(DATA_KEY_IDENTITY, identity);
    return identity;
}

export function getIdentityForChannel(channelId: string): KeyPair {
    return channelIdentities[channelId] ?? getIdentity();
}

export function hasChannelOverride(channelId: string): boolean {
    return channelId in channelIdentities;
}

export async function setChannelIdentity(channelId: string, label: string): Promise<KeyPair> {
    const keyPair = await generateIdentity(label);
    channelIdentities = { ...channelIdentities, [channelId]: keyPair };
    await DataStore.set(DATA_KEY_CHANNEL_IDENTITIES, channelIdentities);
    return keyPair;
}

export async function clearChannelIdentity(channelId: string) {
    if (!(channelId in channelIdentities)) return;
    const { [channelId]: _removed, ...rest } = channelIdentities;
    channelIdentities = rest;
    await DataStore.set(DATA_KEY_CHANNEL_IDENTITIES, channelIdentities);
}

export function getPeerKey(userId: string): PeerKey | undefined {
    return peerKeys[userId];
}

export async function setPeerKey(userId: string, peerKey: PeerKey) {
    peerKeys = { ...peerKeys, [userId]: peerKey };
    await DataStore.set(DATA_KEY_PEER_KEYS, peerKeys);
}

export function hasAnnouncedTo(userId: string): boolean {
    return announcedTo.includes(userId);
}

export async function markAnnouncedTo(userId: string) {
    if (announcedTo.includes(userId)) return;
    announcedTo = [...announcedTo, userId];
    await DataStore.set(DATA_KEY_ANNOUNCED_TO, announcedTo);
}

export async function forgetAnnouncedTo(userId: string) {
    if (!announcedTo.includes(userId)) return;
    announcedTo = announcedTo.filter(id => id !== userId);
    await DataStore.set(DATA_KEY_ANNOUNCED_TO, announcedTo);
}

export function isChannelDisabled(channelId: string): boolean {
    return disabledChannels.includes(channelId);
}

export async function setChannelDisabled(channelId: string, disabled: boolean) {
    const isDisabled = disabledChannels.includes(channelId);
    if (disabled === isDisabled) return;
    disabledChannels = disabled
        ? [...disabledChannels, channelId]
        : disabledChannels.filter(id => id !== channelId);
    await DataStore.set(DATA_KEY_DISABLED_CHANNELS, disabledChannels);
}

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

// Prefix put in front of every message we encrypt. Required by spec so both
// this plugin (and a human eyeballing the chat) can recognise ciphertext.
export const ENCRYPTED_PREFIX = "ENCRYPTED-LOCK";

// Prefix used for the (plaintext, in-chat) public key announcement messages
// that implement automatic key exchange between two DM participants.
export const KEY_ANNOUNCE_PREFIX = "GPG-PUBKEY-LOCK";

export const DATA_KEY_IDENTITY = "GpgEncryption_Identity";
export const DATA_KEY_CHANNEL_IDENTITIES = "GpgEncryption_ChannelIdentities";
export const DATA_KEY_PEER_KEYS = "GpgEncryption_PeerKeys";
export const DATA_KEY_ANNOUNCED_TO = "GpgEncryption_AnnouncedTo";
export const DATA_KEY_ENABLED_CHANNELS = "GpgEncryption_EnabledChannels";

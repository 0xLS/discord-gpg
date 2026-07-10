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

import * as openpgp from "openpgp";

export interface KeyPair {
    publicKey: string;
    privateKey: string;
    fingerprint: string;
}

export async function generateIdentity(userIdLabel: string): Promise<KeyPair> {
    const { privateKey, publicKey } = await openpgp.generateKey({
        type: "curve25519",
        userIDs: [{ name: userIdLabel }],
        format: "armored"
    });

    return {
        publicKey,
        privateKey,
        fingerprint: await getFingerprint(publicKey)
    };
}

export async function getFingerprint(armoredPublicKey: string): Promise<string> {
    const key = await openpgp.readKey({ armoredKey: armoredPublicKey });
    return key.getFingerprint().toUpperCase();
}

export async function encryptText(
    text: string,
    recipientPublicKeys: string[],
    ownPrivateKeyArmored: string
): Promise<string> {
    const [encryptionKeys, signingKeys, message] = await Promise.all([
        Promise.all(recipientPublicKeys.map(k => openpgp.readKey({ armoredKey: k }))),
        openpgp.readPrivateKey({ armoredKey: ownPrivateKeyArmored }),
        openpgp.createMessage({ text })
    ]);

    return openpgp.encrypt({
        message,
        encryptionKeys,
        signingKeys,
        format: "armored"
    }) as Promise<string>;
}

export interface DecryptResult {
    text: string;
    signatureVerified: boolean;
}

export async function decryptText(
    armoredMessage: string,
    ownPrivateKeyArmored: string,
    verifyWithPublicKeyArmored?: string
): Promise<DecryptResult> {
    const [decryptionKeys, message, verificationKeys] = await Promise.all([
        openpgp.readPrivateKey({ armoredKey: ownPrivateKeyArmored }),
        openpgp.readMessage({ armoredMessage }),
        verifyWithPublicKeyArmored
            ? Promise.all([openpgp.readKey({ armoredKey: verifyWithPublicKeyArmored })])
            : Promise.resolve(undefined)
    ]);

    const { data, signatures } = await openpgp.decrypt({
        message,
        decryptionKeys,
        verificationKeys,
        format: "utf8"
    });

    let signatureVerified = false;
    if (verificationKeys && signatures.length) {
        try {
            await signatures[0].verified;
            signatureVerified = true;
        } catch {
            signatureVerified = false;
        }
    }

    return { text: data, signatureVerified };
}

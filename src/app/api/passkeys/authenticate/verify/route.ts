import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import prisma from "@/lib/db";
import {
  clearPasskeyChallenge,
  createPasskeyGrant,
  getPasskeyOrigin,
  getPasskeyRpID,
  readPasskeyChallenge,
} from "@/lib/passkeys";

type AuthenticationInfoShape = {
  newCounter?: number;
};

type StoredAuthenticator = NonNullable<Parameters<typeof verifyAuthenticationResponse>[0]["authenticator"]>;

function parseTransports(raw: string): StoredAuthenticator["transports"] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed as NonNullable<StoredAuthenticator["transports"]> : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const storedChallenge = await readPasskeyChallenge("authenticate");
  if (!storedChallenge?.userId) {
    return NextResponse.json({ error: "Authentication challenge expired. Try again." }, { status: 400 });
  }

  const { response } = await request.json();

  const credential = await prisma.passkeyCredential.findFirst({
    where: {
      userId: storedChallenge.userId,
      credentialID: String(response?.id ?? ""),
    },
    include: { user: { select: { id: true, email: true } } },
  });

  if (!credential) {
    await clearPasskeyChallenge();
    return NextResponse.json({ error: "That passkey is not recognised for this account." }, { status: 404 });
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: storedChallenge.challenge,
    expectedOrigin: getPasskeyOrigin(),
    expectedRPID: getPasskeyRpID(),
    requireUserVerification: true,
    authenticator: {
      credentialID: isoBase64URL.toBuffer(credential.credentialID),
      credentialPublicKey: isoBase64URL.toBuffer(credential.publicKey),
      counter: credential.counter,
      transports: parseTransports(credential.transports),
    },
  });

  await clearPasskeyChallenge();

  if (!verification.verified) {
    return NextResponse.json({ error: "Passkey authentication failed." }, { status: 400 });
  }

  const authenticationInfo = verification.authenticationInfo as AuthenticationInfoShape | undefined;

  await prisma.passkeyCredential.update({
    where: { id: credential.id },
    data: {
      counter: authenticationInfo?.newCounter ?? credential.counter,
      lastUsedAt: new Date(),
    },
  });

  return NextResponse.json({
    verified: true,
    grant: createPasskeyGrant(credential.user.id),
    email: credential.user.email,
  });
}
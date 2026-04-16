import { NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import prisma from "@/lib/db";
import { auth } from "@/auth";
import {
  clearPasskeyChallenge,
  getPasskeyOrigin,
  getPasskeyRpID,
  readPasskeyChallenge,
} from "@/lib/passkeys";

type RegistrationInfoShape = {
  credential?: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] };
  credentialID?: string | Uint8Array;
  credentialPublicKey?: Uint8Array;
  counter?: number;
  credentialDeviceType?: string;
  credentialBackedUp?: boolean;
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storedChallenge = await readPasskeyChallenge("register");
  if (!storedChallenge || storedChallenge.userId !== session.user.id) {
    return NextResponse.json({ error: "Registration challenge expired. Try again." }, { status: 400 });
  }

  const { response, name } = await request.json();

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: storedChallenge.challenge,
    expectedOrigin: getPasskeyOrigin(),
    expectedRPID: getPasskeyRpID(),
    requireUserVerification: true,
  });

  await clearPasskeyChallenge();

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Passkey registration could not be verified." }, { status: 400 });
  }

  const registrationInfo = verification.registrationInfo as RegistrationInfoShape;
  const credentialID = registrationInfo.credential?.id
    ?? (typeof registrationInfo.credentialID === "string"
      ? registrationInfo.credentialID
      : Buffer.from(registrationInfo.credentialID ?? []).toString("base64url"));
  const publicKey = registrationInfo.credential?.publicKey ?? registrationInfo.credentialPublicKey;
  const counter = registrationInfo.credential?.counter ?? registrationInfo.counter ?? 0;
  const transports = response.response?.transports ?? registrationInfo.credential?.transports ?? [];

  if (!credentialID || !publicKey) {
    return NextResponse.json({ error: "Passkey registration did not return a credential." }, { status: 400 });
  }

  await prisma.passkeyCredential.upsert({
    where: { credentialID },
    update: {
      userId: session.user.id,
      name: String(name ?? "").trim() || "Passkey",
      publicKey: Buffer.from(publicKey).toString("base64url"),
      counter,
      transports: JSON.stringify(transports),
      deviceType: registrationInfo.credentialDeviceType ?? "singleDevice",
      backedUp: Boolean(registrationInfo.credentialBackedUp),
      lastUsedAt: new Date(),
    },
    create: {
      userId: session.user.id,
      name: String(name ?? "").trim() || "Passkey",
      credentialID,
      publicKey: Buffer.from(publicKey).toString("base64url"),
      counter,
      transports: JSON.stringify(transports),
      deviceType: registrationInfo.credentialDeviceType ?? "singleDevice",
      backedUp: Boolean(registrationInfo.credentialBackedUp),
      lastUsedAt: new Date(),
    },
  });

  return NextResponse.json({ verified: true });
}
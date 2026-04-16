import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import prisma from "@/lib/db";
import { auth } from "@/auth";
import { getPasskeyRpID, storePasskeyChallenge } from "@/lib/passkeys";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existingPasskeys = await prisma.passkeyCredential.findMany({
    where: { userId: session.user.id },
    select: { credentialID: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: "Wyndos",
    rpID: getPasskeyRpID(),
    userID: session.user.id,
    userName: session.user.email,
    userDisplayName: session.user.name ?? session.user.email,
    timeout: 60000,
    attestationType: "none",
    excludeCredentials: existingPasskeys.map((credential: { credentialID: string; transports: string }) => ({
      id: credential.credentialID,
      type: "public-key" as const,
      transports: JSON.parse(credential.transports || "[]"),
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
    supportedAlgorithmIDs: [-7, -257],
  });

  await storePasskeyChallenge({
    action: "register",
    challenge: options.challenge,
    userId: session.user.id,
    expiresAt: Date.now() + 1000 * 60 * 5,
  });

  return NextResponse.json(options);
}
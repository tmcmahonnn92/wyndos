import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import prisma from "@/lib/db";
import { auth } from "@/auth";
import { getPasskeyRpID, storePasskeyChallenge } from "@/lib/passkeys";

type ExcludeCredentialDescriptor = NonNullable<
  Parameters<typeof generateRegistrationOptions>[0]["excludeCredentials"]
>[number];

function parseTransports(raw: string): ExcludeCredentialDescriptor["transports"] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed as NonNullable<ExcludeCredentialDescriptor["transports"]> : [];
  } catch {
    return [];
  }
}

export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existingPasskeys = await prisma.passkeyCredential.findMany({
    where: { userId: session.user.id },
    select: { credentialID: true, transports: true },
  });

  const excludeCredentials: ExcludeCredentialDescriptor[] = existingPasskeys.map((credential) => ({
    id: isoBase64URL.toBuffer(credential.credentialID),
    type: "public-key",
    transports: parseTransports(credential.transports),
  }));

  const options = await generateRegistrationOptions({
    rpName: "Wyndos",
    rpID: getPasskeyRpID(),
    userID: session.user.id,
    userName: session.user.email,
    userDisplayName: session.user.name ?? session.user.email,
    timeout: 60000,
    attestationType: "none",
    excludeCredentials,
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
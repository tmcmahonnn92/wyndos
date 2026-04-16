import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import prisma from "@/lib/db";
import { auth } from "@/auth";
import { storePasskeyChallenge, getPasskeyRpID } from "@/lib/passkeys";

type AllowCredentialDescriptor = NonNullable<
  NonNullable<Parameters<typeof generateAuthenticationOptions>[0]>["allowCredentials"]
>[number];

function parseTransports(raw: string): AllowCredentialDescriptor["transports"] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed as NonNullable<AllowCredentialDescriptor["transports"]> : [];
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const body = await request.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();

  const user = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true } })
    : email
      ? await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
      : null;

  if (!user) {
    return NextResponse.json({ error: "No matching account was found for that passkey." }, { status: 404 });
  }

  const credentials = await prisma.passkeyCredential.findMany({
    where: { userId: user.id },
    select: { credentialID: true, transports: true },
  });

  if (credentials.length === 0) {
    return NextResponse.json({ error: "No passkeys are set up for this account." }, { status: 404 });
  }

  const allowCredentials: AllowCredentialDescriptor[] = credentials.map((credential) => ({
    id: isoBase64URL.toBuffer(credential.credentialID),
    type: "public-key",
    transports: parseTransports(credential.transports),
  }));

  const options = await generateAuthenticationOptions({
    rpID: getPasskeyRpID(),
    timeout: 60000,
    userVerification: "required",
    allowCredentials,
  });

  await storePasskeyChallenge({
    action: "authenticate",
    challenge: options.challenge,
    userId: user.id,
    email: user.email,
    expiresAt: Date.now() + 1000 * 60 * 5,
  });

  return NextResponse.json(options);
}
import { NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/prisma';
import { createSessionCookie } from '@/lib/auth';
import { getRpID, getOrigin } from '@/lib/webauthn-config';

export async function POST(request: Request) {
  const { studentId, response } = await request.json();
  
  const sId = parseInt(studentId, 10);
  const student = await prisma.student.findUnique({
    where: { studentId: sId },
    include: { authenticators: true }
  });

  if (!student || !student.currentWebAuthnChallenge) {
    return NextResponse.json({ error: "Invalid student or no active challenge" }, { status: 400 });
  }

  const authenticator = student.authenticators.find(
    auth => auth.credentialID === response.id
  );

  if (!authenticator) {
    return NextResponse.json({ error: "Authenticator not found" }, { status: 400 });
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: student.currentWebAuthnChallenge,
      expectedOrigin: getOrigin(request),
      expectedRPID: getRpID(request),
      credential: {
        id: authenticator.credentialID,
        publicKey: new Uint8Array(authenticator.credentialPublicKey),
        counter: Number(authenticator.counter),
      },
    });

    const { verified, authenticationInfo } = verification;

    if (verified && authenticationInfo) {
      await prisma.authenticator.update({
        where: { credentialID: authenticator.credentialID },
        data: { counter: BigInt(authenticationInfo.newCounter) }
      });

      await prisma.student.update({
        where: { studentId: sId },
        data: { currentWebAuthnChallenge: null }
      });

      await createSessionCookie(sId);

      return NextResponse.json({ verified: true });
    }
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ verified: false }, { status: 400 });
}

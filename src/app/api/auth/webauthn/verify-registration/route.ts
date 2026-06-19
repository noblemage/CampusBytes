import { NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { getRpID, getOrigin } from '@/lib/webauthn-config';

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({ where: { studentId: session.studentId } });
  if (!student || !student.currentWebAuthnChallenge) {
    return NextResponse.json({ error: "No active challenge" }, { status: 400 });
  }

  const body = await request.json();

  try {
    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: student.currentWebAuthnChallenge,
      expectedOrigin: getOrigin(request),
      expectedRPID: getRpID(request),
    });

    const { verified, registrationInfo } = verification;

    if (verified && registrationInfo) {
      const { credentialDeviceType, credentialBackedUp, credential } = registrationInfo;
      const { id: credentialID, publicKey: credentialPublicKey, counter } = credential;

      const credentialIDStr = typeof credentialID === 'string' 
        ? credentialID 
        : Buffer.from(credentialID as any).toString('base64url');

      await prisma.authenticator.create({
        data: {
          credentialID: credentialIDStr,
          credentialPublicKey: Buffer.from(credentialPublicKey),
          counter: BigInt(counter),
          credentialDeviceType,
          credentialBackedUp,
          studentId: student.studentId
        }
      });

      await prisma.student.update({
        where: { studentId: student.studentId },
        data: { currentWebAuthnChallenge: null }
      });

      return NextResponse.json({ verified: true });
    }
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ verified: false }, { status: 400 });
}

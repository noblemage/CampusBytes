import { NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { rpName, getRpID } from '@/lib/webauthn-config';

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const student = await prisma.student.findUnique({
    where: { studentId: session.studentId },
    include: { authenticators: true }
  });
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

  const options = await generateRegistrationOptions({
    rpName,
    rpID: getRpID(request),
    userID: new Uint8Array(Buffer.from(student.studentId.toString())),
    userName: student.name,
    attestationType: 'none',
    excludeCredentials: student.authenticators.map(auth => ({
      id: auth.credentialID,
      type: 'public-key',
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required', // Cloud-synced passkey
      userVerification: 'preferred',
    },
  });

  await prisma.student.update({
    where: { studentId: student.studentId },
    data: { currentWebAuthnChallenge: options.challenge }
  });

  return NextResponse.json(options);
}

import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { prisma } from '@/lib/prisma';
import { getRpID } from '@/lib/webauthn-config';

export async function POST(request: Request) {
  const { studentId } = await request.json();
  if (!studentId) return NextResponse.json({ error: "Missing student ID" }, { status: 400 });

  const sId = parseInt(studentId, 10);
  const student = await prisma.student.findUnique({
    where: { studentId: sId },
    include: { authenticators: true }
  });

  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  if (student.authenticators.length === 0) {
    return NextResponse.json({ error: "No biometrics registered for this student" }, { status: 400 });
  }

  const options = await generateAuthenticationOptions({
    rpID: getRpID(request),
    allowCredentials: student.authenticators.map(auth => ({
      id: auth.credentialID,
      type: 'public-key',
    })),
    userVerification: 'required',
  });

  await prisma.student.update({
    where: { studentId: sId },
    data: { currentWebAuthnChallenge: options.challenge }
  });

  return NextResponse.json(options);
}

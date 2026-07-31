"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createEntry(formData: FormData) {
  const title = str(formData, "title");
  if (!title) throw new Error("title is required");
  const entry = await prisma.entry.create({
    data: {
      title,
      source: str(formData, "source") || null,
      kind: str(formData, "kind") || "book",
      note: str(formData, "note") || null,
    },
  });
  revalidatePath("/");
  revalidatePath("/entries");
  redirect(`/entries/${entry.id}`);
}

export async function createApplication(formData: FormData) {
  const entryId = str(formData, "entryId");
  const appliedTo = str(formData, "appliedTo");
  const note = str(formData, "note");
  if (!entryId || !appliedTo || !note) throw new Error("required fields missing");
  await prisma.application.create({
    data: {
      entryId,
      appliedTo,
      note,
      decisionChanged: str(formData, "decisionChanged") || null,
    },
  });
  revalidatePath("/");
  revalidatePath(`/entries/${entryId}`);
}

export async function createExperiment(formData: FormData) {
  const entryId = str(formData, "entryId");
  const action = str(formData, "action");
  const successMetric = str(formData, "successMetric");
  if (!entryId || !action || !successMetric) throw new Error("required fields missing");
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 30 * 86400000);
  const experiment = await prisma.experiment.create({
    data: { entryId, action, successMetric, startDate, endDate },
  });
  revalidatePath("/");
  revalidatePath(`/entries/${entryId}`);
  redirect(`/experiments/${experiment.id}`);
}

export async function createCheckIn(formData: FormData) {
  const experimentId = str(formData, "experimentId");
  if (!experimentId) throw new Error("experimentId is required");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await prisma.checkIn.upsert({
    where: { experimentId_date: { experimentId, date: today } },
    create: {
      experimentId,
      date: today,
      done: true,
      note: str(formData, "note") || null,
    },
    update: { done: true, note: str(formData, "note") || null },
  });
  revalidatePath("/");
  revalidatePath(`/experiments/${experimentId}`);
}

export async function completeExperiment(formData: FormData) {
  const experimentId = str(formData, "experimentId");
  if (!experimentId) throw new Error("experimentId is required");
  await prisma.experiment.update({
    where: { id: experimentId },
    data: {
      status: str(formData, "status") === "abandoned" ? "abandoned" : "completed",
      outcome: str(formData, "outcome") || null,
    },
  });
  revalidatePath("/");
  revalidatePath(`/experiments/${experimentId}`);
}

export async function joinWaitlist(formData: FormData) {
  const email = str(formData, "email");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    redirect("/lp?error=1");
  }
  await prisma.waitlistSignup.upsert({
    where: { email },
    create: { email },
    update: {},
  });
  revalidatePath("/lp");
  redirect("/lp?joined=1");
}

// SM-2 簡易版: score 0-2 は interval=1, 3 は据え置き, 4-5 は interval*easeFactor
export async function reviewCard(formData: FormData) {
  const cardId = str(formData, "cardId");
  const score = Number(str(formData, "score"));
  if (!cardId || Number.isNaN(score) || score < 0 || score > 5) {
    throw new Error("invalid review");
  }
  const card = await prisma.srCard.findUniqueOrThrow({ where: { id: cardId } });

  let interval = card.interval;
  let easeFactor = card.easeFactor;
  let repetitions = card.repetitions + 1;

  if (score <= 2) {
    interval = 1;
    repetitions = 0;
  } else if (score === 3) {
    // 据え置き
  } else {
    interval = Math.max(1, Math.round(interval * easeFactor));
  }
  easeFactor = Math.max(
    1.3,
    easeFactor + (0.1 - (5 - score) * (0.08 + (5 - score) * 0.02))
  );

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  await prisma.srCard.update({
    where: { id: cardId },
    data: { interval, easeFactor, repetitions, score, lastReview: new Date(), nextReview },
  });
  revalidatePath("/");
  revalidatePath("/cards");
}

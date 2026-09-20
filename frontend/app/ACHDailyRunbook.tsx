"use client";

import RailDailyRunbook from "./RailDailyRunbook";

export default function ACHDailyRunbook({
  scenario,
  transactionId,
  screenContext,
}: {
  scenario: string;
  transactionId?: string | null;
  screenContext?: Record<string, unknown>;
}) {
  return (
    <RailDailyRunbook
      rail="ach"
      scenario={scenario}
      transactionId={transactionId}
      screenContext={screenContext}
    />
  );
}

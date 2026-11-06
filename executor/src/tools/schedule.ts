const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const buildDeliveryWindow = (
  now: Date = new Date(),
  activeDays = 10
): { endDate: string; startDate: string } => {
  if (!Number.isInteger(activeDays) || activeDays < 1) {
    throw new Error("activeDays must be a positive integer");
  }

  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() + 1);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + activeDays - 1);

  return { endDate: isoDate(end), startDate: isoDate(start) };
};

import {
  FORMAT_DECIMALS_MILLION,
  FORMAT_DECIMALS_THOUSAND,
  MILLION,
  MINUTES_PER_HOUR,
  MS_PER_MINUTE,
  SECONDS_PER_MINUTE,
  THOUSAND,
} from '../constants';

const INVALID_RETURN_VALUE = '-';

/**
 * Make the numbers in the thousands and millions human readable.
 * Typically this is for message and token count.
 *
 * @example
 * formatNumber(1743267) // '1.74M'
 * formatNumber(1700)    // '1.7K'
 * formatNumber(500)     // '500'
 */
export function formatNumber(number: number): string {
  if (number >= MILLION) {
    const dividedByMillion = number / MILLION;
    return `${dividedByMillion.toFixed(FORMAT_DECIMALS_MILLION)}M`;
  }
  if (number >= THOUSAND) {
    const dividedByThousand = number / THOUSAND;
    return `${dividedByThousand.toFixed(FORMAT_DECIMALS_THOUSAND)}K`;
  }
  return number.toLocaleString();
}

/**
 * Make currency human readable
 *
 * @example
 * formatCurrency(3.231232) // '$3.23'
 * formatCurrency(0.5)      // '$0.50'
 */
export function formatCurrency(number: number): string {
  return `$${number.toFixed(2)}`;
}

/**
 * Formats ISO date time to shortened human readable
 *
 * @example
 * formatDateTime('2026-03-29T10:30:00Z') // '3/29/2026 10:30 AM'
 * formatDateTime(null)                    // '-'
 */
export function formatDateTime(isoDateTime: string | null): string {
  if (!isoDateTime) {
    return INVALID_RETURN_VALUE;
  }

  const date = new Date(isoDateTime);
  const isValidDateTimeString = Number.isNaN(date.getTime());
  if (isValidDateTimeString) {
    return INVALID_RETURN_VALUE;
  }

  const dateString = date.toLocaleDateString();
  const timeString = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateString} ${timeString}`;
}

/**
 * Format ISO date time to full human readable
 *
 * @example
 * formatFullDateTime('2026-03-29T10:30:00Z') // 'March 29, 2026, 10:30:00 AM GMT'
 * formatFullDateTime(null)                    // ''
 */
export function formatFullDateTime(isoDateTime: string | null): string {
  if (!isoDateTime) {
    return '';
  }

  const date = new Date(isoDateTime);
  const isValidDateTimeString = Number.isNaN(date.getTime());
  if (isValidDateTimeString) {
    return INVALID_RETURN_VALUE;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Format start and end time into human readable time duration
 *
 * @example
 * formatDuration('2026-03-29T10:00:00Z', '2026-03-29T11:30:00Z') // '1h 30m'
 * formatDuration('2026-03-29T10:00:00Z', '2026-03-29T10:45:00Z') // '45m'
 * formatDuration(null, null)                                       // '-'
 */
export function formatDuration(
  startTime: string | null,
  endTime: string | null,
): string {
  if (!(startTime && endTime)) {
    return INVALID_RETURN_VALUE;
  }

  try {
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    const isInvalidDateString = Number.isNaN(start) || Number.isNaN(end);
    const isInvalidDuration = end < start;
    if (isInvalidDateString || isInvalidDuration) {
      return INVALID_RETURN_VALUE;
    }

    const minutes = Math.round((end - start) / MS_PER_MINUTE);
    if (minutes < 1) {
      return '<1m';
    }
    if (minutes < MINUTES_PER_HOUR) {
      return `${minutes}m`;
    }

    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    const remainingMinutes = minutes % MINUTES_PER_HOUR;
    return `${hours}h ${remainingMinutes}m`;
  } catch {
    return INVALID_RETURN_VALUE;
  }
}

/**
 * Formats seconds to be human readable
 *
 * @example
 * formatDurationSeconds(3661) // '1h 1m'
 * formatDurationSeconds(45)   // '1m'
 * formatDurationSeconds(20)   // '<1m'
 */
export function formatDurationSeconds(seconds: number): string {
  const isNegativeSeconds = seconds <= 0;
  if (isNegativeSeconds) {
    return INVALID_RETURN_VALUE;
  }

  const minutes = Math.round(seconds / SECONDS_PER_MINUTE);
  const isUnderOneMinute = minutes < 1;
  if (isUnderOneMinute) {
    return '<1m';
  }

  const isMinutesLessThanHour = minutes < MINUTES_PER_HOUR;
  if (isMinutesLessThanHour) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const remainingMinutes = minutes % MINUTES_PER_HOUR;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format hours to be human readable
 *
 * @example
 * formatHours(2.5)  // '2h 30m'
 * formatHours(0.75) // '45m'
 * formatHours(3)    // '3h'
 */
export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) {
    return `${m}m`;
  }
  if (m === 0) {
    return `${h}h`;
  }
  return `${h}h ${m}m`;
}

/**
 * Format to human readable month
 *
 * @example
 * formatMonth('2026-03') // 'Mar 2026'
 * formatMonth('2025-12') // 'Dec 2025'
 */
export function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number.parseInt(year, 10), Number.parseInt(m, 10) - 1);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

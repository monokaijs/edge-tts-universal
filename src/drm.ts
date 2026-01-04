import { TRUSTED_CLIENT_TOKEN } from './constants';
import { SkewAdjustmentError } from "./exceptions";
import { sha256val } from './utils/sha256';

const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;

/**
 * DRM class for handling Microsoft Edge TTS authentication.
 * Manages clock skew and generates security tokens.
 */
export class DRM {
  private static clockSkewSeconds = 0.0;

  static adjClockSkewSeconds(skewSeconds: number) {
    DRM.clockSkewSeconds += skewSeconds;
  }

  static getUnixTimestamp(): number {
    return Date.now() / 1000 + DRM.clockSkewSeconds;
  }

  static parseRfc2616Date(date: string): number | null {
    try {
      return new Date(date).getTime() / 1000;
    } catch (e) {
      return null;
    }
  }

  static handleClientResponseError(response: { status: number; headers: any }) {
    let serverDate: string | null = null;

    if ('headers' in response && typeof response.headers === 'object') {
      if ('get' in response.headers && typeof response.headers.get === 'function') {
        // Fetch Response object
        serverDate = response.headers.get("date");
      } else {
        // Plain object with headers
        const headers = response.headers as Record<string, string>;
        serverDate = headers["date"] || headers["Date"];
      }
    }

    if (!serverDate) {
      throw new SkewAdjustmentError("No server date in headers.");
    }
    const serverDateParsed = DRM.parseRfc2616Date(serverDate);
    if (serverDateParsed === null) {
      throw new SkewAdjustmentError(`Failed to parse server date: ${serverDate}`);
    }
    const clientDate = DRM.getUnixTimestamp();
    DRM.adjClockSkewSeconds(serverDateParsed - clientDate);
  }

  static async generateSecMsGec(): Promise<string> {
    let ticks = DRM.getUnixTimestamp();
    ticks += WIN_EPOCH;
    ticks -= ticks % 300;
    ticks *= S_TO_NS / 100;

    const strToHash = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;

    return sha256val(strToHash);
  }
}
import { default as originalFetch } from 'node-fetch';
import fetchRetry from 'fetch-retry';
import DigestClient from 'digest-fetch';
import { DeviceConfiguration, DigestClientOptions } from "../types.js";

export abstract class BaseDevice {
  protected configuration: DeviceConfiguration;

  constructor(configuration: DeviceConfiguration) {
    this.configuration = configuration;
  }

  protected getDigestClient(options?: DigestClientOptions) {
    const retryCount = this.configuration.retryCount ?? 0;

    if (retryCount <= 0) {
      return new DigestClient(this.configuration.username, this.configuration.password, {
        client: originalFetch,
        ...options,
      });
    }

    const fetchWithRetry = fetchRetry(originalFetch, {
      retryOn: (attempt, error, response) => attempt < retryCount && (error !== null || !response?.status || response.status >= 500),
      retryDelay: this.configuration.retryDelay ?? 1000
    });

    return new DigestClient(this.configuration.username, this.configuration.password, {
      client: fetchWithRetry,
      ...options,
    });
  }

  protected buildURL(path: string) {
    if (!path.startsWith('/')) {
      path = '/' + path;
    }

    return `${this.configuration.ipOrHttpAddress}:${this.configuration.port}${path}`;
  }

  protected get timeoutSignal() {
    return this.configuration.timeout ? AbortSignal.timeout(this.configuration.timeout) : undefined;
  }
}


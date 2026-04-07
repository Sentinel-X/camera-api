export type DeviceConfiguration = {
  ipOrHttpAddress: string;
  port: number;
  username: string;
  password: string;
  serialNumber?: string | null;
  retryCount?: number;
  retryDelay?: number;
  timeout?: number;
}

export type DigestClientOptions = {
  client?: unknown;
}

export type InvasionAreaCoordinate = {
  x: number;
  y: number;
}

export interface Device {
  getInvasionAreaCoordinates(): Promise<InvasionAreaCoordinate[]>;
  setInvasionAreaCoordinates(coordinates: InvasionAreaCoordinate[]): Promise<void>;
}
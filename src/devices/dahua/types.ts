import { BaseImageQualityConfiguration } from '../../types.js';

export interface InvasionAreaPoint {
    x: number;
    y: number;
}

export type ImageQualityConfiguration = BaseImageQualityConfiguration & {
    shotQuality?: 'minimum' | 'medium' | 'maximum';
};

export type TimeConfiguration = {
    timeFormat?: string; // e.g: dd-MM-yyyy HH:mm:ss
    ntp?: {
        enabled: boolean;
        server?: string;
        port?: number;
        interval?: number; // in minutes 0 to 1440 (0 = no calibration)
    };
    timezoneName?: string; // e.g: "UTC-0" or "Brasilia"
    timeZoneId?: number; // e.g: 0 for UTC-0, 22 for Brasilia
    dst?: {
        enabled: boolean;
    }
};

export type OverlayConfiguration = {
    channelTitle?: {
        name?: string;
        encodeBlend?: boolean;
        previewBlend?: boolean;
        rect?: [number, number, number, number];
    };
    timeTitle?: {
        encodeBlend?: boolean;
        previewBlend?: boolean;
        rect?: [number, number, number, number];
        showWeek?: boolean;
    };
};

export type DddnsConfiguration =
    | {
        enabled: false;
        address?: never;
        hostname?: never;
        port?: never;
        protocol?: never;
        username?: never;
        password?: never;
    }
    | {
        enabled: true;
        address: string;
        hostname: string;
        port: number;
        protocol: 'Dyndns DDNS';
        username: string;
        password: string;
    };

export type DefocusConfiguration = {
    enabled: boolean;
    sensitivityLevel: number; // 1 to 100
    dejitterTime: number;
    delayTime: number;
    snapshotEnabled: boolean;
    recordEnabled: boolean;
    recordDelayTime: number;
    alarmEnabled: boolean;
    alarmDelayTime: number;
};

export type VideoTamperingConfiguration = {
    enabled: boolean;
    sensitivityLevel: number; // 1 to 6
    duration: number; // in seconds
    percentage: number; // 1 to 100
    dejitterTime: number; // in seconds
    delayTime: number; // in seconds
    snapshotEnabled: boolean;
    recordEnabled: boolean;
    recordDelayTime: number; // in seconds
    alarmEnabled: boolean;
    alarmDelayTime: number; // in seconds
};

export type SceneChangeConfiguration = {
    enabled: boolean;
    sensitivityLevel: number; // 1 to 5
    delayTime: number; // in seconds
    dejitterTime: number; // in seconds
    snapshotEnabled: boolean;
    recordEnabled: boolean;
    recordDelayTime: number; // in seconds
    alarmEnabled: boolean;
    alarmDelayTime: number; // in seconds
};

export type InvasionAreaConfiguration = {
    enabled: boolean;
    ruleName: string;
    snapshotEnabled: boolean;
    snapshotTitleEnabled: boolean;
    snapshotInterval: number;
    snapshotTimes: number;
    objectTypes: ('human' | 'vehicle')[];
    webhookConfiguration?: {
        enabled: boolean;
        address: string;
        port: number;
        path: string;
    };
};

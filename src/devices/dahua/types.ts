import { BaseImageQualityConfiguration } from "../../types.js";

export interface InvasionAreaPoint {
    x: number;
    y: number;
}

export type ImageQualityConfiguration = BaseImageQualityConfiguration & {
    shotQuality?: 'minimum' | 'medium' | 'maximum';
};

import { BaseImageQualityConfiguration } from "../../types.js";

export type ImageQualityConfiguration = BaseImageQualityConfiguration & {
    smartCodec?: boolean;
    bitrate?: {
        constant: number;
        variableCap: number;
        variableAverage: number;
    }
};

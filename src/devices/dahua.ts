import { setTimeout } from 'timers/promises';
import { HttpRequestError, MissingConfigurationError } from "../errors.js";
import { Device, InvasionAreaCoordinate } from "../types.js";
import { BaseDevice } from "./base.js";

interface InvasionAreaPoint {
    x: number;
    y: number;
}

export class DahuaDevice extends BaseDevice implements Device {
    async getInvasionAreaCoordinates(): Promise<InvasionAreaCoordinate[]> {
        const { ruleConfig, ruleNumber } = await this.getAreaInvasionRule();

        const hasAreaCoordinate = ruleConfig.includes(`table.VideoAnalyseRule[0][${ruleNumber}].Config.DetectRegion`);
        if (!hasAreaCoordinate) {
            return [];
        }

        let maxX = 8191;
        let maxY = 8191;

        // Rounding helper (limit to 5 decimal places)
        const round = (value: number): number => Math.round(value * 1e5) / 1e5;

        // Normalization helper, clamps value between 0 and max, then normalizes to 0-1 range (%)
        const normalize = (value: number, max: number): number => {
            const clamped = Math.min(Math.max(value, 0), max);
            return round(clamped / max);
        };

        const maxSizeRegex = new RegExp(
            `VideoAnalyseRule\\[0\\]\\[${ruleNumber}\\]\\.Config\\.SizeFilter\\.MaxSize\\[(\\d)\\]\\s*=\\s*(\\d+)`,
            'g'
        );

        let match: RegExpExecArray | null;
        while ((match = maxSizeRegex.exec(ruleConfig)) !== null) {
            const axis: number = Number(match[1]);
            const value: number = Number(match[2]);

            if (axis === 0) {
                maxX = value;
            }
            if (axis === 1) {
                maxY = value;
            }
        }

        const detectRegionRegex = new RegExp(
            `VideoAnalyseRule\\[0\\]\\[${ruleNumber}\\]\\.Config\\.DetectRegion\\[(\\d+)\\]\\[(\\d)\\]\\s*=\\s*(-?\\d+)`,
            'g'
        );

        const points: Map<number, Partial<InvasionAreaPoint>> = new Map();

        while ((match = detectRegionRegex.exec(ruleConfig)) !== null) {
            const pointIndex: number = Number(match[1]);
            const axis: number = Number(match[2]);
            const value: number = Number(match[3]);

            if (!points.has(pointIndex)) {
                points.set(pointIndex, {});
            }

            const point = points.get(pointIndex)!;

            if (axis === 0) {
                point.x = value;
            }
            if (axis === 1) {
                point.y = value;
            }
        }

        return [...points.entries()]
            .sort(([a], [b]) => a - b)
            .filter((entry): entry is [number, InvasionAreaPoint] => Number.isFinite(entry[1].x) && Number.isFinite(entry[1].y))
            .map(([, point]) => ({
                x: normalize(point.x, maxX),
                y: normalize(point.y, maxY),
            }));
    }

    async setInvasionAreaCoordinates(coordinates: InvasionAreaCoordinate[]) {
        const { ruleConfig, ruleNumber } = await this.getAreaInvasionRule();

        await this.removeCurrentAreaInvasionCoordinates(ruleConfig, ruleNumber);

        const areaPointsParams = new URLSearchParams();
        const convertedPoints = this.convertAreaInvasionCoordinatesToCamera(ruleConfig, ruleNumber, coordinates);

        for (const [i, point] of convertedPoints.entries()) {
            areaPointsParams.append(`VideoAnalyseRule[0][${ruleNumber}].Config.DetectRegion[${i}][0]`, point.x.toString());
            areaPointsParams.append(`VideoAnalyseRule[0][${ruleNumber}].Config.DetectRegion[${i}][1]`, point.y.toString());
        }

        if (areaPointsParams.size > 0) {
            await this.addConfigs(areaPointsParams);
        }
    }

    private async getAreaInvasionRule() {
        const ruleConfig = await this.getConfig('VideoAnalyseRule');

        let ruleNumber = -1;
        for (let i = 0; i < 100; i++) {
            if (!ruleConfig.includes(`table.VideoAnalyseRule[0][${i}]`)) {
                break;
            }

            if (
                ruleConfig.includes(`table.VideoAnalyseRule[0][${i}].Class=Normal`) &&
                ruleConfig.includes(`table.VideoAnalyseRule[0][${i}].Type=CrossRegionDetection`)
            ) {
                ruleNumber = i;
                break;
            }
        }

        if (ruleNumber === -1 || !ruleConfig.includes(`table.VideoAnalyseRule[0][${ruleNumber}].Type=CrossRegionDetection`)) {
            throw new MissingConfigurationError();
        }

        return { ruleConfig, ruleNumber }
    }

    private async removeCurrentAreaInvasionCoordinates(ruleConfig: string, ruleNumber: number) {
        const regex = new RegExp(
            `VideoAnalyseRule\\[0\\]\\[${ruleNumber}\\]\\.Config\\.DetectRegion\\[(\\d+)\\]\\[\\d+\\]`,
            'g'
        );

        let match: RegExpExecArray | null;
        let lastCoordinateIndex = -1;

        while ((match = regex.exec(ruleConfig)) !== null) {
            const current = Number(match[1]);
            if (current > lastCoordinateIndex) {
                lastCoordinateIndex = current;
            }
        }

        const numberOfCoordinates = (lastCoordinateIndex + 1) * 2; // Zero based * 2 (x and y axis)
        for (let i = 0; i < numberOfCoordinates; i++) {
            await this.removeConfig(`VideoAnalyseRule[0][${ruleNumber}].Config.DetectRegion[0][0]`);
            await setTimeout(100); // The camera has a delay to process the removal
        }
    }

    private convertAreaInvasionCoordinatesToCamera(ruleConfig: string, ruleNumber: number, coordinates: InvasionAreaCoordinate[]) {
        let maxX = 8191;
        let maxY = 8191;

        const maxSizeRegex = new RegExp(
            `VideoAnalyseRule\\[0\\]\\[${ruleNumber}\\]\\.Config\\.SizeFilter\\.MaxSize\\[(\\d)\\]\\s*=\\s*(\\d+)`,
            'g'
        );

        let match: RegExpExecArray | null;
        while ((match = maxSizeRegex.exec(ruleConfig)) !== null) {
            const axis: number = Number(match[1]);
            const value: number = Number(match[2]);

            if (axis === 0) {
                maxX = value;
            }
            if (axis === 1) {
                maxY = value;
            }
        }

        const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

        return coordinates.map(({ x, y }) => ({
            x: Math.round(clamp(x * maxX, maxX)),
            y: Math.round(clamp(y * maxY, maxY)),
        }));
    }

    private async getConfig(configName: string) {
        const res = await this.getDigestClient().fetch(
            this.buildURL(`/cgi-bin/configManager.cgi?action=getConfig&name=${configName}`),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        return res.text();
    }

    private async removeConfig(configName: string) {
        const res = await this.getDigestClient().fetch(
            this.buildURL(`/cgi-bin/configManager.cgi?action=removeConfig&name=${configName}`),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200 || !(await res.text())?.trim()?.toLowerCase()?.includes('ok')) {
            throw new HttpRequestError();
        }
    }

    private async addConfigs(configs: URLSearchParams) {
        const res = await this.getDigestClient().fetch(
            this.buildURL(`/cgi-bin/configManager.cgi?action=addConfig&${configs.toString()}`),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200 || !(await res.text())?.trim()?.toLowerCase()?.includes('ok')) {
            throw new HttpRequestError();
        }
    }
}

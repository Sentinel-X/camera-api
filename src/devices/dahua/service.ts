import { setTimeout } from 'timers/promises';
import moment from 'moment-timezone';
import { HttpRequestError, MissingConfigurationError, NotImplementedError } from '../../errors.js';
import { InvasionAreaCoordinate } from '../../types.js';
import { BaseDevice } from '../base.js';
import { DddnsConfiguration, DefocusConfiguration, ImageQualityConfiguration, InvasionAreaPoint, OverlayConfiguration, SceneChangeConfiguration, TimeConfiguration, VideoTamperingConfiguration } from './types.js';
import { timezones } from './constants.js';

export class DahuaDevice extends BaseDevice {
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

    async setImageQualityConfiguration(configuration: ImageQualityConfiguration) {
        const config = await this.getConfig('Encode');
        const queryParams = new URLSearchParams();
        const channelCount = 4;

        for (let i = 0; i < channelCount; i++) {
            if (typeof configuration.compression === 'string') {
                const cameraCompression = configuration.compression === 'h264' ? 'H.264' : 'H.265';
                const key = `Encode[0].MainFormat[${i}].Video.Compression`;

                if (config.includes(key) && !config.includes(`${key}=${cameraCompression}`)) {
                    queryParams.append(key, cameraCompression);
                }
            }

            if (typeof configuration.fps === 'number') {
                const key = `Encode[0].MainFormat[${i}].Video.FPS`;

                if (config.includes(key) && !config.includes(`${key}=${configuration.fps}`)) {
                    queryParams.append(key, configuration.fps.toString());
                }
            }

            if (configuration.resolution?.width) {
                const key = `Encode[0].MainFormat[${i}].Video.Width`;

                if (config.includes(key) && !config.includes(`${key}=${configuration.resolution.width}`)) {
                    queryParams.append(key, configuration.resolution.width.toString());
                }
            }

            if (configuration.resolution?.height) {
                const key = `Encode[0].MainFormat[${i}].Video.Height`;

                if (config.includes(key) && !config.includes(`${key}=${configuration.resolution.height}`)) {
                    queryParams.append(key, configuration.resolution.height.toString());
                }
            }

            if (typeof configuration.bitrate?.constant === 'number') {
                const key = `Encode[0].MainFormat[${i}].Video.Bitrate`;

                if (config.includes(key) && !config.includes(`${key}=${configuration.bitrate.constant}`)) {
                    queryParams.append(key, configuration.bitrate.constant.toString());
                }
            }

            if (typeof configuration.shotQuality === 'string') {
                const maxSupportedQualityRegex = new RegExp(
                    `table\\.Encode\\[0\\]\\.SnapFormat\\[${i}\\]\\.Video\\.QualityRange=(\\d+)`
                );
                const match = config.match(maxSupportedQualityRegex);
                const maxSupportedQuality = match && Number.isInteger(Number(match[1])) ? Number(match[1]) : undefined;

                if (maxSupportedQuality) {
                    const qualityMap = {
                        'minimum': 1,
                        'medium': Math.max(1, Math.min(Math.floor(maxSupportedQuality / 2), maxSupportedQuality)),
                        'maximum': maxSupportedQuality
                    };
                    const expectedQuality = qualityMap[configuration.shotQuality];

                    const key = `Encode[0].SnapFormat[${i}].Video.Quality`;

                    if (config.includes(key) && !config.includes(`${key}=${expectedQuality}`)) {
                        queryParams.append(key, expectedQuality.toString());
                    }
                }
            }
        }

        if (queryParams.size > 0) {
            await this.setConfigs(queryParams);
        }
    }

    async setTimeConfiguration(timeConfiguration: TimeConfiguration) {
        const localeQueryParams = new URLSearchParams();
        const localesConfig = await this.getConfig('Locales');

        if (typeof timeConfiguration.timeFormat === 'string' && !this.stringIncludesWithLineBreak(localesConfig, `Locales.TimeFormat=${timeConfiguration.timeFormat}`)) {
            localeQueryParams.append('Locales.TimeFormat', timeConfiguration.timeFormat);
        }

        if (typeof timeConfiguration.dst?.enabled === 'boolean' && !this.stringIncludesWithLineBreak(localesConfig, `Locales.DSTEnable=${timeConfiguration.dst.enabled}`)) {
            localeQueryParams.append('Locales.DSTEnable', timeConfiguration.dst.enabled.toString());
        }

        if (localeQueryParams.size > 0) {
            await this.setConfigs(localeQueryParams, { encodeSpaces: true });
        }

        const ntpQueryParams = new URLSearchParams();
        const ntpConfig = await this.getConfig('NTP');

        if (typeof timeConfiguration.ntp?.enabled === 'boolean' && !this.stringIncludesWithLineBreak(ntpConfig, `NTP.Enable=${timeConfiguration.ntp.enabled}`)) {
            ntpQueryParams.append('NTP.Enable', timeConfiguration.ntp.enabled.toString());
        }

        if (typeof timeConfiguration.ntp?.server === 'string' && !this.stringIncludesWithLineBreak(ntpConfig, `NTP.Address=${timeConfiguration.ntp.server}`)) {
            ntpQueryParams.append('NTP.Address', timeConfiguration.ntp.server);
        }

        if (typeof timeConfiguration.ntp?.port === 'number' && !this.stringIncludesWithLineBreak(ntpConfig, `NTP.Port=${timeConfiguration.ntp.port}`)) {
            ntpQueryParams.append('NTP.Port', timeConfiguration.ntp.port.toString());
        }

        if (typeof timeConfiguration.ntp?.interval === 'number' && !this.stringIncludesWithLineBreak(ntpConfig, `NTP.UpdatePeriod=${timeConfiguration.ntp.interval}`)) {
            ntpQueryParams.append('NTP.UpdatePeriod', timeConfiguration.ntp.interval.toString());
        }

        if (typeof timeConfiguration.timeZoneId === 'number' && !this.stringIncludesWithLineBreak(ntpConfig, `NTP.TimeZone=${timeConfiguration.timeZoneId}`)) {
            ntpQueryParams.append('NTP.TimeZone', timeConfiguration.timeZoneId.toString());
        }

        if (typeof timeConfiguration.timezoneName === 'string' && !this.stringIncludesWithLineBreak(ntpConfig, `NTP.TimeZoneDesc=${timeConfiguration.timezoneName}`)) {
            ntpQueryParams.append('NTP.TimeZoneDesc', timeConfiguration.timezoneName);
        }

        if (ntpQueryParams.size > 0) {
            await this.setConfigs(ntpQueryParams);
        }
    }

    async getCurrentTime(): Promise<Date> {
        const ntpConfig = await this.getConfig('NTP');
        const timezoneId: string = ntpConfig.match(/NTP\.TimeZone=(\d+)/)?.[1];

        if (!timezoneId || !timezones[timezoneId]) {
            throw new MissingConfigurationError('Unable to determine camera timezone. Please set the timezone configuration before getting the current time.');
        }

        const res = await this.getDigestClient().fetch(
            this.buildURL('/cgi-bin/global.cgi?action=getCurrentTime'),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200) {
            throw new HttpRequestError();
        }

        const cameraTime = (await res.text()).split('=')[1].replace(/(?:\r\n|\r|\n)/g, '').trim();
        const timezoneOffset = timezones[timezoneId].offset;

        return moment(cameraTime, 'YYYY-MM-DD HH:mm:ss').utcOffset(timezoneOffset, true).toDate();
    }

    async setCurrentTime(date: Date) {
        const currentTime = moment.utc(date).format('YYYY-MM-DD HH:mm:ss');

        const timeRes = await this.getDigestClient().fetch(
            this.buildURL(`/cgi-bin/global.cgi?action=setCurrentTime&time=${currentTime}`),
            {
                signal: this.timeoutSignal
            }
        );

        if (timeRes.status !== 200) {
            throw new HttpRequestError();
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

    public async reboot() {
        throw new NotImplementedError('Rebooting Dahua cameras is not supported yet');
    }

    public async setOverlayConfiguration(overlayConfig: OverlayConfiguration) {
        const channelTitleConfig = overlayConfig.channelTitle;
        if (channelTitleConfig?.name !== undefined) {
            const channelTitleParams = new URLSearchParams();
            const currentChannelTitleConfig = await this.getConfig('ChannelTitle');

            if (!this.stringIncludesWithLineBreak(currentChannelTitleConfig, `ChannelTitle[0].Name=${channelTitleConfig.name}`)) {
                channelTitleParams.append('ChannelTitle[0].Name', channelTitleConfig.name);
            }

            if (channelTitleParams.size > 0) {
                await this.setConfigs(channelTitleParams, { encodeSpaces: true });
            }
        }

        const hasVideoWidgetUpdate =
            overlayConfig.channelTitle?.encodeBlend !== undefined ||
            overlayConfig.channelTitle?.previewBlend !== undefined ||
            overlayConfig.channelTitle?.rect !== undefined ||
            overlayConfig.timeTitle?.encodeBlend !== undefined ||
            overlayConfig.timeTitle?.previewBlend !== undefined ||
            overlayConfig.timeTitle?.rect !== undefined ||
            overlayConfig.timeTitle?.showWeek !== undefined;

        if (!hasVideoWidgetUpdate) {
            return;
        }

        const osdQueryParams = new URLSearchParams();
        const osdConfig = await this.getConfig('VideoWidget');

        if (overlayConfig.channelTitle?.encodeBlend !== undefined) {
            const key = 'VideoWidget[0].ChannelTitle.EncodeBlend';
            const value = overlayConfig.channelTitle.encodeBlend.toString();
            if (!this.stringIncludesWithLineBreak(osdConfig, `${key}=${value}`)) {
                osdQueryParams.append(key, value);
            }
        }

        if (overlayConfig.channelTitle?.previewBlend !== undefined) {
            const key = 'VideoWidget[0].ChannelTitle.PreviewBlend';
            const value = overlayConfig.channelTitle.previewBlend.toString();
            if (!this.stringIncludesWithLineBreak(osdConfig, `${key}=${value}`)) {
                osdQueryParams.append(key, value);
            }
        }

        if (overlayConfig.channelTitle?.rect) {
            const [x1, y1, x2, y2] = overlayConfig.channelTitle.rect;
            const rectValues = [x1, y1, x2, y2];

            for (let i = 0; i < rectValues.length; i++) {
                const key = `VideoWidget[0].ChannelTitle.Rect[${i}]`;
                const value = rectValues[i].toString();
                if (!this.stringIncludesWithLineBreak(osdConfig, `${key}=${value}`)) {
                    osdQueryParams.append(key, value);
                }
            }
        }

        if (overlayConfig.timeTitle?.encodeBlend !== undefined) {
            const key = 'VideoWidget[0].TimeTitle.EncodeBlend';
            const value = overlayConfig.timeTitle.encodeBlend.toString();
            if (!this.stringIncludesWithLineBreak(osdConfig, `${key}=${value}`)) {
                osdQueryParams.append(key, value);
            }
        }

        if (overlayConfig.timeTitle?.previewBlend !== undefined) {
            const key = 'VideoWidget[0].TimeTitle.PreviewBlend';
            const value = overlayConfig.timeTitle.previewBlend.toString();
            if (!this.stringIncludesWithLineBreak(osdConfig, `${key}=${value}`)) {
                osdQueryParams.append(key, value);
            }
        }

        if (overlayConfig.timeTitle?.rect) {
            const [x1, y1, x2, y2] = overlayConfig.timeTitle.rect;
            const rectValues = [x1, y1, x2, y2];

            for (let i = 0; i < rectValues.length; i++) {
                const key = `VideoWidget[0].TimeTitle.Rect[${i}]`;
                const value = rectValues[i].toString();
                if (!this.stringIncludesWithLineBreak(osdConfig, `${key}=${value}`)) {
                    osdQueryParams.append(key, value);
                }
            }
        }

        if (overlayConfig.timeTitle?.showWeek !== undefined) {
            const key = 'VideoWidget[0].TimeTitle.ShowWeek';
            const value = overlayConfig.timeTitle.showWeek.toString();
            if (!this.stringIncludesWithLineBreak(osdConfig, `${key}=${value}`)) {
                osdQueryParams.append(key, value);
            }
        }

        if (osdQueryParams.size > 0) {
            await this.setConfigs(osdQueryParams);
        }

    }

    public async setDdnsConfiguration(configuration: DddnsConfiguration) {
        if (!configuration.enabled) {
            return this.setConfigs(new URLSearchParams(
                [
                    ['DDNS[0].Enable', 'false'],
                ]
            ), { encodeSpaces: true });
        }

        return this.setConfigs(new URLSearchParams(
            [
                ['DDNS[0].Enable', 'true'],
                ['DDNS[0].Address', configuration.address],
                ['DDNS[0].HostName', configuration.hostname],
                ['DDNS[0].Port', configuration.port.toString()],
                ['DDNS[0].Protocol', configuration.protocol],
                ['DDNS[0].UserName', configuration.username],
                ['DDNS[0].Password', configuration.password],
            ]
        ), { encodeSpaces: true });
    }

    public async setDefocusConfiguration(defocusConfiguration: DefocusConfiguration) {
        const defocusConfig = await this.getConfig('UnFocusDetect');
        const defocusConfigQueryParams = new URLSearchParams();

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].Enable=${defocusConfiguration.enabled}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].Enable', defocusConfiguration.enabled.toString());
        }

        // 1 to 100, where 1 is the lowest sensitivity and 100 is the highest sensitivity.
        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].Sensitivity=${defocusConfiguration.sensitivityLevel}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].Sensitivity', defocusConfiguration.sensitivityLevel.toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.Dejitter=${defocusConfiguration.dejitterTime}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.Dejitter', defocusConfiguration.dejitterTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.Delay=${defocusConfiguration.delayTime}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.Delay', defocusConfiguration.delayTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.SnapshotEnable=${defocusConfiguration.snapshotEnabled}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.SnapshotEnable', defocusConfiguration.snapshotEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.Snapshot=${defocusConfiguration.snapshotEnabled ? 1 : 0}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.Snapshot', (defocusConfiguration.snapshotEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.RecordEnable=${defocusConfiguration.recordEnabled}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.RecordEnable', defocusConfiguration.recordEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.Record=${defocusConfiguration.recordEnabled ? 1 : 0}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.Record', (defocusConfiguration.recordEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.RecordLatch=${defocusConfiguration.recordDelayTime}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.RecordLatch', defocusConfiguration.recordDelayTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.AlarmOutEnable=${defocusConfiguration.alarmEnabled}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.AlarmOutEnable', defocusConfiguration.alarmEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.AlarmOut=${defocusConfiguration.alarmEnabled ? 1 : 0}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.AlarmOut', (defocusConfiguration.alarmEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(defocusConfig, `UnFocusDetect[0].EventHandler.AlarmOutLatch=${defocusConfiguration.alarmDelayTime}`)) {
            defocusConfigQueryParams.append('UnFocusDetect[0].EventHandler.AlarmOutLatch', defocusConfiguration.alarmDelayTime.toString());
        }

        if (defocusConfigQueryParams.size > 0) {
            await this.setConfigs(defocusConfigQueryParams);
        }
    }

    public async setVideoTamperingConfiguration(videoTamperingConfiguration: VideoTamperingConfiguration) {
        const videoTamperingConfig = await this.getConfig('BlindDetect');
        const videoTamperingConfigQueryParams = new URLSearchParams();

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].Enable=${videoTamperingConfiguration.enabled}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].Enable', videoTamperingConfiguration.enabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].Duration=${videoTamperingConfiguration.duration}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].Duration', videoTamperingConfiguration.duration.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].Percent=${videoTamperingConfiguration.percentage}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].Percent', videoTamperingConfiguration.percentage.toString());
        }

        // Sensitivity of blind detection. 1: lowest sensitivity. 6: highest sensitivity.
        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].Level=${videoTamperingConfiguration.sensitivityLevel}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].Level', videoTamperingConfiguration.sensitivityLevel.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.Dejitter=${videoTamperingConfiguration.dejitterTime}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.Dejitter', videoTamperingConfiguration.dejitterTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.Delay=${videoTamperingConfiguration.delayTime}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.Delay', videoTamperingConfiguration.delayTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.SnapshotEnable=${videoTamperingConfiguration.snapshotEnabled}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.SnapshotEnable', videoTamperingConfiguration.snapshotEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.Snapshot=${videoTamperingConfiguration.snapshotEnabled ? 1 : 0}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.Snapshot', (videoTamperingConfiguration.snapshotEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.RecordEnable=${videoTamperingConfiguration.recordEnabled}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.RecordEnable', videoTamperingConfiguration.recordEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.Record=${videoTamperingConfiguration.recordEnabled ? 1 : 0}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.Record', (videoTamperingConfiguration.recordEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.RecordLatch=${videoTamperingConfiguration.recordDelayTime}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.RecordLatch', videoTamperingConfiguration.recordDelayTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.AlarmOutEnable=${videoTamperingConfiguration.alarmEnabled}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.AlarmOutEnable', videoTamperingConfiguration.alarmEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.AlarmOut=${videoTamperingConfiguration.alarmEnabled ? 1 : 0}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.AlarmOut', (videoTamperingConfiguration.alarmEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(videoTamperingConfig, `BlindDetect[0].EventHandler.AlarmOutLatch=${videoTamperingConfiguration.alarmDelayTime}`)) {
            videoTamperingConfigQueryParams.append('BlindDetect[0].EventHandler.AlarmOutLatch', videoTamperingConfiguration.alarmDelayTime.toString());
        }

        if (videoTamperingConfigQueryParams.size > 0) {
            await this.setConfigs(videoTamperingConfigQueryParams);
        }
    }

    public async setSceneChangeConfiguration(videoTamperingConfiguration: SceneChangeConfiguration) {
        const sceneChangeConfig = await this.getConfig('MovedDetect');
        const sceneChangeConfigQueryParams = new URLSearchParams();

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].Enable=${videoTamperingConfiguration.enabled}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].Enable', videoTamperingConfiguration.enabled.toString());
        }

        // 1 to 5, where 1 is the lowest sensitivity and 5 is the highest sensitivity.
        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].Sensitivity=${videoTamperingConfiguration.sensitivityLevel}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].Sensitivity', videoTamperingConfiguration.sensitivityLevel.toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.Delay=${videoTamperingConfiguration.delayTime}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.Delay', videoTamperingConfiguration.delayTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.Dejitter=${videoTamperingConfiguration.dejitterTime}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.Dejitter', videoTamperingConfiguration.dejitterTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.SnapshotEnable=${videoTamperingConfiguration.snapshotEnabled}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.SnapshotEnable', videoTamperingConfiguration.snapshotEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.Snapshot=${videoTamperingConfiguration.snapshotEnabled ? 1 : 0}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.Snapshot', (videoTamperingConfiguration.snapshotEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.RecordEnable=${videoTamperingConfiguration.recordEnabled}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.RecordEnable', videoTamperingConfiguration.recordEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.Record=${videoTamperingConfiguration.recordEnabled ? 1 : 0}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.Record', (videoTamperingConfiguration.recordEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.RecordLatch=${videoTamperingConfiguration.recordDelayTime}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.RecordLatch', videoTamperingConfiguration.recordDelayTime.toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.AlarmOutEnable=${videoTamperingConfiguration.alarmEnabled}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.AlarmOutEnable', videoTamperingConfiguration.alarmEnabled.toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.AlarmOut=${videoTamperingConfiguration.alarmEnabled ? 1 : 0}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.AlarmOut', (videoTamperingConfiguration.alarmEnabled ? 1 : 0).toString());
        }

        if (!this.stringIncludesWithLineBreak(sceneChangeConfig, `MovedDetect[0].EventHandler.AlarmOutLatch=${videoTamperingConfiguration.alarmDelayTime}`)) {
            sceneChangeConfigQueryParams.append('MovedDetect[0].EventHandler.AlarmOutLatch', videoTamperingConfiguration.alarmDelayTime.toString());
        }

        if (sceneChangeConfigQueryParams.size > 0) {
            await this.setConfigs(sceneChangeConfigQueryParams);
        }
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

    private async setConfigs(configs: URLSearchParams, queryOptions?: {
        encodeSpaces?: boolean;
    }) {
        let queryParams = configs.toString();

        if (queryOptions?.encodeSpaces) {
            queryParams = queryParams.replaceAll('+', '%20');
        }

        const res = await this.getDigestClient().fetch(
            this.buildURL(`/cgi-bin/configManager.cgi?action=setConfig&${queryParams}`),
            {
                signal: this.timeoutSignal
            }
        );

        if (res.status !== 200 || !(await res.text())?.trim()?.toLowerCase()?.includes('ok')) {
            throw new HttpRequestError();
        }
    }

    private stringIncludesWithLineBreak(text: string, match: string) {
        return text.includes(match + '\r\n') || text.includes(match + '\r') || text.includes(match + '\n');
    }
}

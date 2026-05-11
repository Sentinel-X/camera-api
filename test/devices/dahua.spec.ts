import { expect } from 'chai';
import { after, afterEach, before, describe, it } from 'mocha';
import nock from 'nock';
import { DahuaDevice } from '../../src/devices/dahua/service.js';
import { HttpRequestError, MissingConfigurationError } from '../../src/errors.js';
import { DeviceConfiguration } from '../../src/types.js';

const defaultConfig: DeviceConfiguration = {
    ipOrHttpAddress: 'http://camera.test',
    port: 80,
    username: 'admin',
    password: 'password'
};

describe('DahuaDevice', () => {
    before(() => {
        nock.disableNetConnect();
    });

    after(() => {
        nock.enableNetConnect();
    });

    afterEach(() => {
        expect(nock.isDone()).to.equal(true);
        nock.cleanAll();
    });

    it('returns normalized invasion area coordinates', async () => {
        const payload = [
            'table.VideoAnalyseRule[0][0].Class=Normal',
            'table.VideoAnalyseRule[0][0].Type=CrossRegionDetection',
            'table.VideoAnalyseRule[0][0].Config.SizeFilter.MaxSize[0]=8191',
            'table.VideoAnalyseRule[0][0].Config.SizeFilter.MaxSize[1]=8191',
            'table.VideoAnalyseRule[0][0].Config.DetectRegion[0][0]=0',
            'table.VideoAnalyseRule[0][0].Config.DetectRegion[0][1]=0',
            'table.VideoAnalyseRule[0][0].Config.DetectRegion[1][0]=8191',
            'table.VideoAnalyseRule[0][0].Config.DetectRegion[1][1]=8191'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        const coordinates = await device.getInvasionAreaCoordinates();

        expect(coordinates).to.deep.equal([
            { x: 0, y: 0 },
            { x: 1, y: 1 }
        ]);
    });

    it('throws MissingConfigurationError when area invasion rule is absent', async () => {
        const payload = [
            'table.VideoAnalyseRule[0][0].Class=Normal',
            'table.VideoAnalyseRule[0][0].Type=Tripwire'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.getInvasionAreaCoordinates();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it('converts normalized coordinates and sends addConfig request', async () => {
        const payload = [
            'table.VideoAnalyseRule[0][0].Class=Normal',
            'table.VideoAnalyseRule[0][0].Type=CrossRegionDetection',
            'table.VideoAnalyseRule[0][0].Config.SizeFilter.MaxSize[0]=100',
            'table.VideoAnalyseRule[0][0].Config.SizeFilter.MaxSize[1]=200'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'addConfig',
                'VideoAnalyseRule[0][0].Config.DetectRegion[0][0]': '50',
                'VideoAnalyseRule[0][0].Config.DetectRegion[0][1]': '100',
                'VideoAnalyseRule[0][0].Config.DetectRegion[1][0]': '100',
                'VideoAnalyseRule[0][0].Config.DetectRegion[1][1]': '0'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setInvasionAreaCoordinates([
            { x: 0.5, y: 0.5 },
            { x: 1, y: 0 }
        ]);
    });

    it('throws HttpRequestError when getConfig fails', async () => {
        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(500, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.getInvasionAreaCoordinates();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates image quality configuration for all channels', async () => {
        const payload = [
            'Encode[0].MainFormat[0].Video.Compression=H.264',
            'Encode[0].MainFormat[0].Video.FPS=15',
            'Encode[0].MainFormat[0].Video.Width=1280',
            'Encode[0].MainFormat[0].Video.Height=720',
            'Encode[0].MainFormat[0].Video.Bitrate=1024',
            'Encode[0].SnapFormat[0].Video.Quality=1',
            'table.Encode[0].SnapFormat[0].Video.QualityRange=6',
            'Encode[0].MainFormat[1].Video.Compression=H.264',
            'Encode[0].MainFormat[1].Video.FPS=15',
            'Encode[0].MainFormat[1].Video.Width=1280',
            'Encode[0].MainFormat[1].Video.Height=720',
            'Encode[0].MainFormat[1].Video.Bitrate=1024',
            'Encode[0].SnapFormat[1].Video.Quality=1',
            'table.Encode[0].SnapFormat[1].Video.QualityRange=6',
            'Encode[0].MainFormat[2].Video.Compression=H.264',
            'Encode[0].MainFormat[2].Video.FPS=15',
            'Encode[0].MainFormat[2].Video.Width=1280',
            'Encode[0].MainFormat[2].Video.Height=720',
            'Encode[0].MainFormat[2].Video.Bitrate=1024',
            'Encode[0].SnapFormat[2].Video.Quality=1',
            'table.Encode[0].SnapFormat[2].Video.QualityRange=6',
            'Encode[0].MainFormat[3].Video.Compression=H.264',
            'Encode[0].MainFormat[3].Video.FPS=15',
            'Encode[0].MainFormat[3].Video.Width=1280',
            'Encode[0].MainFormat[3].Video.Height=720',
            'Encode[0].MainFormat[3].Video.Bitrate=1024',
            'Encode[0].SnapFormat[3].Video.Quality=1',
            'table.Encode[0].SnapFormat[3].Video.QualityRange=6'
        ].join('\n');

        const expectedQuery: Record<string, string> = {
            action: 'setConfig',
            'Encode[0].MainFormat[0].Video.Compression': 'H.265',
            'Encode[0].MainFormat[0].Video.FPS': '30',
            'Encode[0].MainFormat[0].Video.Width': '1920',
            'Encode[0].MainFormat[0].Video.Height': '1080',
            'Encode[0].MainFormat[0].Video.Bitrate': '2048',
            'Encode[0].SnapFormat[0].Video.Quality': '3',
            'Encode[0].MainFormat[1].Video.Compression': 'H.265',
            'Encode[0].MainFormat[1].Video.FPS': '30',
            'Encode[0].MainFormat[1].Video.Width': '1920',
            'Encode[0].MainFormat[1].Video.Height': '1080',
            'Encode[0].MainFormat[1].Video.Bitrate': '2048',
            'Encode[0].SnapFormat[1].Video.Quality': '3',
            'Encode[0].MainFormat[2].Video.Compression': 'H.265',
            'Encode[0].MainFormat[2].Video.FPS': '30',
            'Encode[0].MainFormat[2].Video.Width': '1920',
            'Encode[0].MainFormat[2].Video.Height': '1080',
            'Encode[0].MainFormat[2].Video.Bitrate': '2048',
            'Encode[0].SnapFormat[2].Video.Quality': '3',
            'Encode[0].MainFormat[3].Video.Compression': 'H.265',
            'Encode[0].MainFormat[3].Video.FPS': '30',
            'Encode[0].MainFormat[3].Video.Width': '1920',
            'Encode[0].MainFormat[3].Video.Height': '1080',
            'Encode[0].MainFormat[3].Video.Bitrate': '2048',
            'Encode[0].SnapFormat[3].Video.Quality': '3'
        };

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'Encode' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query(expectedQuery)
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setImageQualityConfiguration({
            compression: 'h265',
            fps: 30,
            resolution: {
                width: 1920,
                height: 1080
            },
            bitrate: {
                constant: 2048
            },
            shotQuality: 'medium'
        });
    });

    it('does not call setConfig when image quality is already up to date', async () => {
        const payload = [
            'Encode[0].MainFormat[0].Video.Compression=H.265',
            'Encode[0].MainFormat[0].Video.FPS=30',
            'Encode[0].MainFormat[0].Video.Width=1920',
            'Encode[0].MainFormat[0].Video.Height=1080',
            'Encode[0].MainFormat[0].Video.Bitrate=2048',
            'Encode[0].SnapFormat[0].Video.Quality=3',
            'table.Encode[0].SnapFormat[0].Video.QualityRange=6',
            'Encode[0].MainFormat[1].Video.Compression=H.265',
            'Encode[0].MainFormat[1].Video.FPS=30',
            'Encode[0].MainFormat[1].Video.Width=1920',
            'Encode[0].MainFormat[1].Video.Height=1080',
            'Encode[0].MainFormat[1].Video.Bitrate=2048',
            'Encode[0].SnapFormat[1].Video.Quality=3',
            'table.Encode[0].SnapFormat[1].Video.QualityRange=6',
            'Encode[0].MainFormat[2].Video.Compression=H.265',
            'Encode[0].MainFormat[2].Video.FPS=30',
            'Encode[0].MainFormat[2].Video.Width=1920',
            'Encode[0].MainFormat[2].Video.Height=1080',
            'Encode[0].MainFormat[2].Video.Bitrate=2048',
            'Encode[0].SnapFormat[2].Video.Quality=3',
            'table.Encode[0].SnapFormat[2].Video.QualityRange=6',
            'Encode[0].MainFormat[3].Video.Compression=H.265',
            'Encode[0].MainFormat[3].Video.FPS=30',
            'Encode[0].MainFormat[3].Video.Width=1920',
            'Encode[0].MainFormat[3].Video.Height=1080',
            'Encode[0].MainFormat[3].Video.Bitrate=2048',
            'Encode[0].SnapFormat[3].Video.Quality=3',
            'table.Encode[0].SnapFormat[3].Video.QualityRange=6'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'Encode' })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        await device.setImageQualityConfiguration({
            compression: 'h265',
            fps: 30,
            resolution: {
                width: 1920,
                height: 1080
            },
            bitrate: {
                constant: 2048
            },
            shotQuality: 'medium'
        });
    });

    it('throws HttpRequestError when setConfig returns non-ok response', async () => {
        const payload = [
            'Encode[0].MainFormat[0].Video.Compression=H.264',
            'Encode[0].MainFormat[0].Video.FPS=15',
            'Encode[0].MainFormat[0].Video.Width=1280',
            'Encode[0].MainFormat[0].Video.Height=720',
            'Encode[0].MainFormat[0].Video.Bitrate=1024',
            'Encode[0].SnapFormat[0].Video.Quality=1',
            'table.Encode[0].SnapFormat[0].Video.QualityRange=6'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'Encode' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setImageQualityConfiguration({
                compression: 'h265',
                fps: 30,
                resolution: {
                    width: 1920,
                    height: 1080
                },
                bitrate: {
                    constant: 2048
                },
                shotQuality: 'medium'
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates time configuration for locales and ntp', async () => {
        const localesPayload = [
            'table.Locales.DSTEnable=false',
            'table.Locales.TimeFormat=dd-MM-yyyy HH:mm:ss'
        ].join('\n');

        const ntpPayload = [
            'table.NTP.Enable=false',
            'table.NTP.Address=time.windows.com',
            'table.NTP.Port=123',
            'table.NTP.UpdatePeriod=10',
            'table.NTP.TimeZone=22',
            'table.NTP.TimeZoneDesc=Brasilia'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'Locales' })
            .reply(200, localesPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'Locales.TimeFormat': 'MM/dd/yyyy HH:mm:ss',
                'Locales.DSTEnable': 'true'
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'NTP' })
            .reply(200, ntpPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'NTP.Enable': 'true',
                'NTP.Address': 'pool.ntp.org',
                'NTP.Port': '124',
                'NTP.UpdatePeriod': '30',
                'NTP.TimeZone': '0',
                'NTP.TimeZoneDesc': 'UTC-0'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setTimeConfiguration({
            timeFormat: 'MM/dd/yyyy HH:mm:ss',
            dst: {
                enabled: true
            },
            ntp: {
                enabled: true,
                server: 'pool.ntp.org',
                port: 124,
                interval: 30
            },
            timeZoneId: 0,
            timezoneName: 'UTC-0'
        });
    });

    it('does not call setConfig when time configuration is already up to date', async () => {
        const localesPayload = [
            'table.Locales.DSTEnable=true',
            'table.Locales.TimeFormat=MM/dd/yyyy HH:mm:ss'
        ].join('\n') + '\n';

        const ntpPayload = [
            'table.NTP.Enable=true',
            'table.NTP.Address=pool.ntp.org',
            'table.NTP.Port=124',
            'table.NTP.UpdatePeriod=30',
            'table.NTP.TimeZone=0',
            'table.NTP.TimeZoneDesc=UTC-0'
        ].join('\n') + '\n';

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'Locales' })
            .reply(200, localesPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'NTP' })
            .reply(200, ntpPayload);

        const device = new DahuaDevice(defaultConfig);

        await device.setTimeConfiguration({
            timeFormat: 'MM/dd/yyyy HH:mm:ss',
            dst: {
                enabled: true
            },
            ntp: {
                enabled: true,
                server: 'pool.ntp.org',
                port: 124,
                interval: 30
            },
            timeZoneId: 0,
            timezoneName: 'UTC-0'
        });
    });

    it('throws HttpRequestError when setTimeConfiguration receives non-ok response', async () => {
        const localesPayload = [
            'table.Locales.DSTEnable=false',
            'table.Locales.TimeFormat=dd-MM-yyyy HH:mm:ss'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'Locales' })
            .reply(200, localesPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setTimeConfiguration({
                timeFormat: 'MM/dd/yyyy HH:mm:ss'
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates overlay configuration for channel title and video widget', async () => {
        const channelTitlePayload = [
            'table.ChannelTitle[0].Name=CAM1'
        ].join('\n');

        const videoWidgetPayload = [
            'table.VideoWidget[0].ChannelTitle.EncodeBlend=false',
            'table.VideoWidget[0].ChannelTitle.PreviewBlend=false',
            'table.VideoWidget[0].ChannelTitle.Rect[0]=0',
            'table.VideoWidget[0].ChannelTitle.Rect[1]=0',
            'table.VideoWidget[0].ChannelTitle.Rect[2]=0',
            'table.VideoWidget[0].ChannelTitle.Rect[3]=0',
            'table.VideoWidget[0].TimeTitle.EncodeBlend=false',
            'table.VideoWidget[0].TimeTitle.PreviewBlend=false',
            'table.VideoWidget[0].TimeTitle.Rect[0]=0',
            'table.VideoWidget[0].TimeTitle.Rect[1]=0',
            'table.VideoWidget[0].TimeTitle.Rect[2]=0',
            'table.VideoWidget[0].TimeTitle.Rect[3]=0',
            'table.VideoWidget[0].TimeTitle.ShowWeek=true'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'ChannelTitle' })
            .reply(200, channelTitlePayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'ChannelTitle[0].Name': 'SMART SAMPA'
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoWidget' })
            .reply(200, videoWidgetPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'VideoWidget[0].ChannelTitle.EncodeBlend': 'true',
                'VideoWidget[0].ChannelTitle.PreviewBlend': 'true',
                'VideoWidget[0].ChannelTitle.Rect[1]': '8191',
                'VideoWidget[0].ChannelTitle.Rect[3]': '8191',
                'VideoWidget[0].TimeTitle.EncodeBlend': 'true',
                'VideoWidget[0].TimeTitle.PreviewBlend': 'true',
                'VideoWidget[0].TimeTitle.Rect[0]': '8191',
                'VideoWidget[0].TimeTitle.Rect[2]': '8191',
                'VideoWidget[0].TimeTitle.ShowWeek': 'false'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setOverlayConfiguration({
            channelTitle: {
                name: 'SMART SAMPA',
                encodeBlend: true,
                previewBlend: true,
                rect: [0, 8191, 0, 8191],
            },
            timeTitle: {
                encodeBlend: true,
                previewBlend: true,
                rect: [8191, 0, 8191, 0],
                showWeek: false,
            }
        });
    });

    it('does not call setConfig when overlay configuration is already up to date', async () => {
        const channelTitlePayload = [
            'table.ChannelTitle[0].Name=SMART SAMPA'
        ].join('\n') + '\n';

        const videoWidgetPayload = [
            'table.VideoWidget[0].ChannelTitle.EncodeBlend=true',
            'table.VideoWidget[0].ChannelTitle.PreviewBlend=true',
            'table.VideoWidget[0].ChannelTitle.Rect[0]=0',
            'table.VideoWidget[0].ChannelTitle.Rect[1]=8191',
            'table.VideoWidget[0].ChannelTitle.Rect[2]=0',
            'table.VideoWidget[0].ChannelTitle.Rect[3]=8191',
            'table.VideoWidget[0].TimeTitle.EncodeBlend=true',
            'table.VideoWidget[0].TimeTitle.PreviewBlend=true',
            'table.VideoWidget[0].TimeTitle.Rect[0]=8191',
            'table.VideoWidget[0].TimeTitle.Rect[1]=0',
            'table.VideoWidget[0].TimeTitle.Rect[2]=8191',
            'table.VideoWidget[0].TimeTitle.Rect[3]=0',
            'table.VideoWidget[0].TimeTitle.ShowWeek=false'
        ].join('\n') + '\n';

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'ChannelTitle' })
            .reply(200, channelTitlePayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoWidget' })
            .reply(200, videoWidgetPayload);

        const device = new DahuaDevice(defaultConfig);

        await device.setOverlayConfiguration({
            channelTitle: {
                name: 'SMART SAMPA',
                encodeBlend: true,
                previewBlend: true,
                rect: [0, 8191, 0, 8191],
            },
            timeTitle: {
                encodeBlend: true,
                previewBlend: true,
                rect: [8191, 0, 8191, 0],
                showWeek: false,
            }
        });
    });

    it('throws HttpRequestError when overlay setConfig returns non-ok response', async () => {
        const channelTitlePayload = [
            'table.ChannelTitle[0].Name=CAM1'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'ChannelTitle' })
            .reply(200, channelTitlePayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setOverlayConfiguration({
                channelTitle: {
                    name: 'SMART SAMPA',
                }
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('disables ddns configuration', async () => {
        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'DDNS[0].Enable': 'false'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setDdnsConfiguration({
            enabled: false
        });
    });

    it('updates ddns configuration when enabled', async () => {
        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'DDNS[0].Enable': 'true',
                'DDNS[0].Address': 'members.dyndns.org',
                'DDNS[0].HostName': 'my-camera.dyndns.org',
                'DDNS[0].Port': '443',
                'DDNS[0].Protocol': 'Dyndns DDNS',
                'DDNS[0].UserName': 'admin-user',
                'DDNS[0].Password': 'secret-pass'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setDdnsConfiguration({
            enabled: true,
            address: 'members.dyndns.org',
            hostname: 'my-camera.dyndns.org',
            port: 443,
            protocol: 'Dyndns DDNS',
            username: 'admin-user',
            password: 'secret-pass',
        });
    });

    it('throws HttpRequestError when ddns setConfig returns non-ok response', async () => {
        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig' && queryObject['DDNS[0].Enable'] === 'true')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setDdnsConfiguration({
                enabled: true,
                address: 'members.dyndns.org',
                hostname: 'my-camera.dyndns.org',
                port: 443,
                protocol: 'Dyndns DDNS',
                username: 'admin-user',
                password: 'secret-pass',
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('returns current time converted using camera timezone', async () => {
        const ntpPayload = [
            'table.NTP.TimeZone=22',
            'table.NTP.TimeZoneDesc=Brasilia'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'NTP' })
            .reply(200, ntpPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/global.cgi')
            .query({ action: 'getCurrentTime' })
            .reply(200, 'result=2026-04-16 00:18:06');

        const device = new DahuaDevice(defaultConfig);

        const currentTime = await device.getCurrentTime();

        expect(currentTime.toISOString()).to.equal('2026-04-16T03:18:06.000Z');
    });

    it('throws MissingConfigurationError when timezone is not configured', async () => {
        const ntpPayload = [
            'table.NTP.Enable=true',
            'table.NTP.Address=time.windows.com'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'NTP' })
            .reply(200, ntpPayload);

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.getCurrentTime();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it('throws HttpRequestError when getCurrentTime request fails', async () => {
        const ntpPayload = [
            'table.NTP.TimeZone=22',
            'table.NTP.TimeZoneDesc=Brasilia'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'NTP' })
            .reply(200, ntpPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/global.cgi')
            .query({ action: 'getCurrentTime' })
            .reply(500, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.getCurrentTime();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('sets current time using utc date value', async () => {
        nock('http://camera.test:80')
            .get('/cgi-bin/global.cgi')
            .query({
                action: 'setCurrentTime',
                time: '2025-03-13 23:09:25'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setCurrentTime(new Date('2025-03-13T23:09:25.000Z'));
    });

    it('throws HttpRequestError when setCurrentTime request fails', async () => {
        nock('http://camera.test:80')
            .get('/cgi-bin/global.cgi')
            .query((queryObject) => queryObject.action === 'setCurrentTime')
            .reply(500, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setCurrentTime(new Date('2025-03-13T23:09:25.000Z'));
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates defocus configuration', async () => {
        const payload = [
            'UnFocusDetect[0].Enable=false',
            'UnFocusDetect[0].Sensitivity=20',
            'UnFocusDetect[0].EventHandler.Dejitter=2',
            'UnFocusDetect[0].EventHandler.Delay=5',
            'UnFocusDetect[0].EventHandler.SnapshotEnable=false',
            'UnFocusDetect[0].EventHandler.Snapshot=0',
            'UnFocusDetect[0].EventHandler.RecordEnable=false',
            'UnFocusDetect[0].EventHandler.Record=0',
            'UnFocusDetect[0].EventHandler.RecordLatch=10',
            'UnFocusDetect[0].EventHandler.AlarmOutEnable=false',
            'UnFocusDetect[0].EventHandler.AlarmOut=0',
            'UnFocusDetect[0].EventHandler.AlarmOutLatch=5'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'UnFocusDetect' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'UnFocusDetect[0].Enable': 'true',
                'UnFocusDetect[0].Sensitivity': '50',
                'UnFocusDetect[0].EventHandler.Dejitter': '5',
                'UnFocusDetect[0].EventHandler.Delay': '10',
                'UnFocusDetect[0].EventHandler.SnapshotEnable': 'true',
                'UnFocusDetect[0].EventHandler.Snapshot': '1',
                'UnFocusDetect[0].EventHandler.RecordLatch': '15',
                'UnFocusDetect[0].EventHandler.AlarmOutEnable': 'true',
                'UnFocusDetect[0].EventHandler.AlarmOut': '1',
                'UnFocusDetect[0].EventHandler.AlarmOutLatch': '20'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setDefocusConfiguration({
            enabled: true,
            sensitivityLevel: 50,
            dejitterTime: 5,
            delayTime: 10,
            snapshotEnabled: true,
            recordEnabled: false,
            recordDelayTime: 15,
            alarmEnabled: true,
            alarmDelayTime: 20
        });
    });

    it('does not call setConfig when defocus configuration is already up to date', async () => {
        const payload = [
            'UnFocusDetect[0].Enable=true',
            'UnFocusDetect[0].Sensitivity=50',
            'UnFocusDetect[0].EventHandler.Dejitter=5',
            'UnFocusDetect[0].EventHandler.Delay=10',
            'UnFocusDetect[0].EventHandler.SnapshotEnable=true',
            'UnFocusDetect[0].EventHandler.Snapshot=1',
            'UnFocusDetect[0].EventHandler.RecordEnable=false',
            'UnFocusDetect[0].EventHandler.Record=0',
            'UnFocusDetect[0].EventHandler.RecordLatch=15',
            'UnFocusDetect[0].EventHandler.AlarmOutEnable=true',
            'UnFocusDetect[0].EventHandler.AlarmOut=1',
            'UnFocusDetect[0].EventHandler.AlarmOutLatch=20'
        ].join('\n') + '\n';

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'UnFocusDetect' })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        await device.setDefocusConfiguration({
            enabled: true,
            sensitivityLevel: 50,
            dejitterTime: 5,
            delayTime: 10,
            snapshotEnabled: true,
            recordEnabled: false,
            recordDelayTime: 15,
            alarmEnabled: true,
            alarmDelayTime: 20
        });
    });

    it('throws HttpRequestError when defocus setConfig returns non-ok response', async () => {
        const payload = [
            'UnFocusDetect[0].Enable=false'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'UnFocusDetect' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setDefocusConfiguration({
                enabled: true,
                sensitivityLevel: 50,
                dejitterTime: 5,
                delayTime: 10,
                snapshotEnabled: true,
                recordEnabled: false,
                recordDelayTime: 15,
                alarmEnabled: true,
                alarmDelayTime: 20
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates video tampering configuration', async () => {
        const payload = [
            'BlindDetect[0].Enable=false',
            'BlindDetect[0].Duration=10',
            'BlindDetect[0].Percent=50',
            'BlindDetect[0].Level=2',
            'BlindDetect[0].EventHandler.Dejitter=1',
            'BlindDetect[0].EventHandler.Delay=2',
            'BlindDetect[0].EventHandler.SnapshotEnable=false',
            'BlindDetect[0].EventHandler.Snapshot=0',
            'BlindDetect[0].EventHandler.RecordEnable=false',
            'BlindDetect[0].EventHandler.Record=0',
            'BlindDetect[0].EventHandler.RecordLatch=5',
            'BlindDetect[0].EventHandler.AlarmOutEnable=false',
            'BlindDetect[0].EventHandler.AlarmOut=0',
            'BlindDetect[0].EventHandler.AlarmOutLatch=0'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'BlindDetect' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'BlindDetect[0].Enable': 'true',
                'BlindDetect[0].Duration': '30',
                'BlindDetect[0].Percent': '80',
                'BlindDetect[0].Level': '4',
                'BlindDetect[0].EventHandler.Dejitter': '3',
                'BlindDetect[0].EventHandler.Delay': '5',
                'BlindDetect[0].EventHandler.SnapshotEnable': 'true',
                'BlindDetect[0].EventHandler.Snapshot': '1',
                'BlindDetect[0].EventHandler.RecordEnable': 'true',
                'BlindDetect[0].EventHandler.Record': '1',
                'BlindDetect[0].EventHandler.RecordLatch': '10',
                'BlindDetect[0].EventHandler.AlarmOutLatch': '0'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setVideoTamperingConfiguration({
            enabled: true,
            sensitivityLevel: 4,
            duration: 30,
            percentage: 80,
            dejitterTime: 3,
            delayTime: 5,
            snapshotEnabled: true,
            recordEnabled: true,
            recordDelayTime: 10,
            alarmEnabled: false,
            alarmDelayTime: 0
        });
    });

    it('does not call setConfig when video tampering configuration is already up to date', async () => {
        const payload = [
            'BlindDetect[0].Enable=true',
            'BlindDetect[0].Duration=30',
            'BlindDetect[0].Percent=80',
            'BlindDetect[0].Level=4',
            'BlindDetect[0].EventHandler.Dejitter=3',
            'BlindDetect[0].EventHandler.Delay=5',
            'BlindDetect[0].EventHandler.SnapshotEnable=true',
            'BlindDetect[0].EventHandler.Snapshot=1',
            'BlindDetect[0].EventHandler.RecordEnable=true',
            'BlindDetect[0].EventHandler.Record=1',
            'BlindDetect[0].EventHandler.RecordLatch=10',
            'BlindDetect[0].EventHandler.AlarmOutEnable=false',
            'BlindDetect[0].EventHandler.AlarmOut=0',
            'BlindDetect[0].EventHandler.AlarmOutLatch=0'
        ].join('\n') + '\n';

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'BlindDetect' })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        await device.setVideoTamperingConfiguration({
            enabled: true,
            sensitivityLevel: 4,
            duration: 30,
            percentage: 80,
            dejitterTime: 3,
            delayTime: 5,
            snapshotEnabled: true,
            recordEnabled: true,
            recordDelayTime: 10,
            alarmEnabled: false,
            alarmDelayTime: 0
        });
    });

    it('throws HttpRequestError when video tampering setConfig returns non-ok response', async () => {
        const payload = [
            'BlindDetect[0].Enable=false'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'BlindDetect' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setVideoTamperingConfiguration({
                enabled: true,
                sensitivityLevel: 4,
                duration: 30,
                percentage: 80,
                dejitterTime: 3,
                delayTime: 5,
                snapshotEnabled: true,
                recordEnabled: true,
                recordDelayTime: 10,
                alarmEnabled: false,
                alarmDelayTime: 0
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates scene change configuration', async () => {
        const payload = [
            'MovedDetect[0].Enable=false',
            'MovedDetect[0].Sensitivity=1',
            'MovedDetect[0].EventHandler.Delay=2',
            'MovedDetect[0].EventHandler.Dejitter=1',
            'MovedDetect[0].EventHandler.SnapshotEnable=false',
            'MovedDetect[0].EventHandler.Snapshot=0',
            'MovedDetect[0].EventHandler.RecordEnable=false',
            'MovedDetect[0].EventHandler.Record=0',
            'MovedDetect[0].EventHandler.RecordLatch=5',
            'MovedDetect[0].EventHandler.AlarmOutEnable=false',
            'MovedDetect[0].EventHandler.AlarmOut=0',
            'MovedDetect[0].EventHandler.AlarmOutLatch=5'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'MovedDetect' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'MovedDetect[0].Enable': 'true',
                'MovedDetect[0].Sensitivity': '3',
                'MovedDetect[0].EventHandler.Delay': '5',
                'MovedDetect[0].EventHandler.Dejitter': '2',
                'MovedDetect[0].EventHandler.RecordEnable': 'true',
                'MovedDetect[0].EventHandler.Record': '1',
                'MovedDetect[0].EventHandler.RecordLatch': '10',
                'MovedDetect[0].EventHandler.AlarmOutEnable': 'true',
                'MovedDetect[0].EventHandler.AlarmOut': '1',
                'MovedDetect[0].EventHandler.AlarmOutLatch': '15'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setSceneChangeConfiguration({
            enabled: true,
            sensitivityLevel: 3,
            delayTime: 5,
            dejitterTime: 2,
            snapshotEnabled: false,
            recordEnabled: true,
            recordDelayTime: 10,
            alarmEnabled: true,
            alarmDelayTime: 15
        });
    });

    it('does not call setConfig when scene change configuration is already up to date', async () => {
        const payload = [
            'MovedDetect[0].Enable=true',
            'MovedDetect[0].Sensitivity=3',
            'MovedDetect[0].EventHandler.Delay=5',
            'MovedDetect[0].EventHandler.Dejitter=2',
            'MovedDetect[0].EventHandler.SnapshotEnable=false',
            'MovedDetect[0].EventHandler.Snapshot=0',
            'MovedDetect[0].EventHandler.RecordEnable=true',
            'MovedDetect[0].EventHandler.Record=1',
            'MovedDetect[0].EventHandler.RecordLatch=10',
            'MovedDetect[0].EventHandler.AlarmOutEnable=true',
            'MovedDetect[0].EventHandler.AlarmOut=1',
            'MovedDetect[0].EventHandler.AlarmOutLatch=15'
        ].join('\n') + '\n';

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'MovedDetect' })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        await device.setSceneChangeConfiguration({
            enabled: true,
            sensitivityLevel: 3,
            delayTime: 5,
            dejitterTime: 2,
            snapshotEnabled: false,
            recordEnabled: true,
            recordDelayTime: 10,
            alarmEnabled: true,
            alarmDelayTime: 15
        });
    });

    it('throws HttpRequestError when scene change setConfig returns non-ok response', async () => {
        const payload = [
            'MovedDetect[0].Enable=false'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'MovedDetect' })
            .reply(200, payload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setSceneChangeConfiguration({
                enabled: true,
                sensitivityLevel: 3,
                delayTime: 5,
                dejitterTime: 2,
                snapshotEnabled: false,
                recordEnabled: true,
                recordDelayTime: 10,
                alarmEnabled: true,
                alarmDelayTime: 15
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates invasion area configuration and enables webhook upload', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=FaceAnalysis'
        ].join('\n');

        const rulePayload = [
            'table.VideoAnalyseRule[0][0].Class=Normal',
            'table.VideoAnalyseRule[0][0].Type=CrossRegionDetection',
            'table.VideoAnalyseRule[0][0].Enable=false',
            'table.VideoAnalyseRule[0][0].Name=Old Rule',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotEnable=false',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotTitleEnable=false',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotPeriod=0',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotTimes=1',
            'table.VideoAnalyseRule[0][0].ObjectTypes[0]=Human'
        ].join('\n');

        const pictureHttpUploadPayload = [
            'table.PictureHttpUpload.Enable=false'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'VideoAnalyseGlobal[0].Scene.Type': 'Normal'
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, rulePayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'addConfig',
                'VideoAnalyseRule[0][0].ObjectTypes[1]': 'Vehicle',
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'VideoAnalyseRule[0][0].Enable': 'true',
                'VideoAnalyseRule[0][0].Name': 'Invasion Area',
                'VideoAnalyseRule[0][0].EventHandler.SnapshotEnable': 'true',
                'VideoAnalyseRule[0][0].EventHandler.SnapshotTitleEnable': 'true',
                'VideoAnalyseRule[0][0].EventHandler.SnapshotPeriod': '5',
                'VideoAnalyseRule[0][0].EventHandler.SnapshotTimes': '2'
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'PictureHttpUpload' })
            .reply(200, pictureHttpUploadPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'addConfig',
                'PictureHttpUpload.Enable': 'true',
                'PictureHttpUpload.UploadServerList[0].Address': '127.0.0.1',
                'PictureHttpUpload.UploadServerList[0].EventType[0]': 'CrossRegionDetection',
                'PictureHttpUpload.UploadServerList[0].Port': '8080',
                'PictureHttpUpload.UploadServerList[0].Uploadpath': '/webhooks/invasion-area'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setInvasionAreaConfiguration({
            enabled: true,
            ruleName: 'Invasion Area',
            snapshotEnabled: true,
            snapshotTitleEnabled: true,
            snapshotInterval: 5,
            snapshotTimes: 2,
            objectTypes: ['human', 'vehicle'],
            webhookConfiguration: {
                enabled: true,
                address: '127.0.0.1',
                port: 8080,
                path: '/webhooks/invasion-area'
            }
        });
    });

    it('does not call setConfig when invasion area configuration is already up to date', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=Normal'
        ].join('\n');

        const rulePayload = [
            'table.VideoAnalyseRule[0][0].Class=Normal',
            'table.VideoAnalyseRule[0][0].Type=CrossRegionDetection',
            'table.VideoAnalyseRule[0][0].Enable=true',
            'table.VideoAnalyseRule[0][0].Name=Invasion Area',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotEnable=true',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotTitleEnable=true',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotPeriod=5',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotTimes=2',
            'table.VideoAnalyseRule[0][0].ObjectTypes[0]=Human'
        ].join('\n') + '\n';

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, rulePayload);

        const device = new DahuaDevice(defaultConfig);

        await device.setInvasionAreaConfiguration({
            enabled: true,
            ruleName: 'Invasion Area',
            snapshotEnabled: true,
            snapshotTitleEnabled: true,
            snapshotInterval: 5,
            snapshotTimes: 2,
            objectTypes: ['human']
        });
    });

    it('disables invasion area configuration when enabled is false', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=Normal'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'VideoAnalyseGlobal[0].Scene.Type': ''
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setInvasionAreaConfiguration({
            enabled: false,
            ruleName: 'Invasion Area',
            snapshotEnabled: false,
            snapshotTitleEnabled: false,
            snapshotInterval: 0,
            snapshotTimes: 1,
            objectTypes: ['human']
        });
    });

    it('throws MissingConfigurationError when invasion area rule is absent', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=Normal'
        ].join('\n');

        const rulePayload = [
            'table.VideoAnalyseRule[0][0].Class=Normal',
            'table.VideoAnalyseRule[0][0].Type=Tripwire'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, rulePayload);

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setInvasionAreaConfiguration({
                enabled: true,
                ruleName: 'Invasion Area',
                snapshotEnabled: true,
                snapshotTitleEnabled: true,
                snapshotInterval: 5,
                snapshotTimes: 2,
                objectTypes: ['human']
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it('throws HttpRequestError when invasion area global setConfig returns non-ok response', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=FaceAnalysis'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig' && queryObject['VideoAnalyseGlobal[0].Scene.Type'] === 'Normal')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setInvasionAreaConfiguration({
                enabled: true,
                ruleName: 'Invasion Area',
                snapshotEnabled: true,
                snapshotTitleEnabled: true,
                snapshotInterval: 5,
                snapshotTimes: 2,
                objectTypes: ['human']
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it('updates face detection configuration and enables webhook upload', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=Normal'
        ].join('\n');

        const rulePayload = [
            'table.VideoAnalyseRule[0][0].Class=FaceDetection',
            'table.VideoAnalyseRule[0][0].Type=FaceDetection',
            'table.VideoAnalyseRule[0][0].Enable=false',
            'table.VideoAnalyseRule[0][0].Config.FeatureEnable=false',
            'table.VideoAnalyseRule[0][0].Config.FaceBeautification.Enable=false',
            'table.VideoAnalyseRule[0][0].Config.FaceBeautification.BeautyLevel=50',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotEnable=false',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotTitleEnable=false',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotPeriod=0',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotTimes=1'
        ].join('\n');

        const faceSnapshotPayload = [
            'table.FaceSnapshot[0].SnapPolicy=Realtime',
            'table.FaceSnapshot[0].CutoutPolicy=Original'
        ].join('\n');

        const faceEnhancementPayload = [
            'table.VideoEncodeROI[0].DynamicTrack=false'
        ].join('\n');

        const pictureHttpUploadPayload = [
            'table.PictureHttpUpload.Enable=false'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'VideoAnalyseGlobal[0].Scene.Type': 'FaceDetection'
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, rulePayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'VideoAnalyseRule[0][0].Enable': 'true',
                'VideoAnalyseRule[0][0].Config.FeatureEnable': 'true',
                'VideoAnalyseRule[0][0].Config.FaceBeautification.Enable': 'true',
                'VideoAnalyseRule[0][0].Config.FaceBeautification.BeautyLevel': '80',
                'VideoAnalyseRule[0][0].EventHandler.SnapshotEnable': 'true',
                'VideoAnalyseRule[0][0].EventHandler.SnapshotTitleEnable': 'true',
                'VideoAnalyseRule[0][0].EventHandler.SnapshotPeriod': '5',
                'VideoAnalyseRule[0][0].EventHandler.SnapshotTimes': '2'
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'FaceSnapshot' })
            .reply(200, faceSnapshotPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'FaceSnapshot[0].SnapPolicy': 'Quality',
                'FaceSnapshot[0].CutoutPolicy': 'Cephalothorax'
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoEncodeROI' })
            .reply(200, faceEnhancementPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'VideoEncodeROI[0].DynamicTrack': 'true'
            })
            .reply(200, 'OK');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'PictureHttpUpload' })
            .reply(200, pictureHttpUploadPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'addConfig',
                'PictureHttpUpload.Enable': 'true',
                'PictureHttpUpload.UploadServerList[0].Address': '127.0.0.1',
                'PictureHttpUpload.UploadServerList[0].EventType[0]': 'FaceDetection',
                'PictureHttpUpload.UploadServerList[0].Port': '8080',
                'PictureHttpUpload.UploadServerList[0].Uploadpath': '/webhooks/face-detection'
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setFaceDetectionConfiguration({
            enabled: true,
            property: true,
            faceBeautification: {
                enabled: true,
                level: 80
            },
            snapshotEnabled: true,
            snapshotTitleEnabled: true,
            snapshotInterval: 5,
            snapshotTimes: 2,
            faceSnapshotConfig: {
                qualityPolicy: 'quality',
                cutoutPolicy: 'cephalothorax'
            },
            faceEnhancementConfig: {
                enabled: true
            },
            webhookConfiguration: {
                enabled: true,
                address: '127.0.0.1',
                port: 8080,
                path: '/webhooks/face-detection'
            }
        });
    });

    it('does not call setConfig when face detection configuration is already up to date', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=FaceDetection'
        ].join('\n');

        const rulePayload = [
            'table.VideoAnalyseRule[0][0].Class=FaceDetection',
            'table.VideoAnalyseRule[0][0].Type=FaceDetection',
            'table.VideoAnalyseRule[0][0].Enable=true',
            'table.VideoAnalyseRule[0][0].Config.FeatureEnable=true',
            'table.VideoAnalyseRule[0][0].Config.FaceBeautification.Enable=false',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotEnable=true',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotTitleEnable=true',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotPeriod=5',
            'table.VideoAnalyseRule[0][0].EventHandler.SnapshotTimes=2'
        ].join('\n') + '\n';

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, rulePayload);

        const device = new DahuaDevice(defaultConfig);

        await device.setFaceDetectionConfiguration({
            enabled: true,
            property: true,
            faceBeautification: {
                enabled: false
            },
            snapshotEnabled: true,
            snapshotTitleEnabled: true,
            snapshotInterval: 5,
            snapshotTimes: 2
        });
    });

    it('disables face detection configuration when enabled is false', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=FaceDetection'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({
                action: 'setConfig',
                'VideoAnalyseGlobal[0].Scene.Type': ''
            })
            .reply(200, 'OK');

        const device = new DahuaDevice(defaultConfig);

        await device.setFaceDetectionConfiguration({
            enabled: false,
            property: false,
            faceBeautification: {
                enabled: false
            },
            snapshotEnabled: false,
            snapshotTitleEnabled: false,
            snapshotInterval: 0,
            snapshotTimes: 1
        });
    });

    it('throws MissingConfigurationError when face detection rule is absent', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=FaceDetection'
        ].join('\n');

        const rulePayload = [
            'table.VideoAnalyseRule[0][0].Class=FaceDetection',
            'table.VideoAnalyseRule[0][0].Type=Tripwire'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseRule' })
            .reply(200, rulePayload);

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setFaceDetectionConfiguration({
                enabled: true,
                property: true,
                faceBeautification: {
                    enabled: false
                },
                snapshotEnabled: true,
                snapshotTitleEnabled: true,
                snapshotInterval: 5,
                snapshotTimes: 2
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it('throws HttpRequestError when face detection global setConfig returns non-ok response', async () => {
        const globalPayload = [
            'table.VideoAnalyseGlobal[0].Scene.Type=Normal'
        ].join('\n');

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query({ action: 'getConfig', name: 'VideoAnalyseGlobal' })
            .reply(200, globalPayload);

        nock('http://camera.test:80')
            .get('/cgi-bin/configManager.cgi')
            .query((queryObject) => queryObject.action === 'setConfig' && queryObject['VideoAnalyseGlobal[0].Scene.Type'] === 'FaceDetection')
            .reply(200, 'error');

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setFaceDetectionConfiguration({
                enabled: true,
                property: true,
                faceBeautification: {
                    enabled: false
                },
                snapshotEnabled: true,
                snapshotTitleEnabled: true,
                snapshotInterval: 5,
                snapshotTimes: 2
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });
});

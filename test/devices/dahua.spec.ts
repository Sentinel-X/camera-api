import { expect } from "chai";
import { after, afterEach, before, describe, it } from "mocha";
import nock from "nock";
import { DahuaDevice } from "../../src/devices/dahua/service.js";
import { HttpRequestError, MissingConfigurationError } from "../../src/errors.js";
import { DeviceConfiguration } from "../../src/types.js";

const defaultConfig: DeviceConfiguration = {
    ipOrHttpAddress: "http://camera.test",
    port: 80,
    username: "admin",
    password: "password"
};

describe("DahuaDevice", () => {
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

    it("returns normalized invasion area coordinates", async () => {
        const payload = [
            "table.VideoAnalyseRule[0][0].Class=Normal",
            "table.VideoAnalyseRule[0][0].Type=CrossRegionDetection",
            "table.VideoAnalyseRule[0][0].Config.SizeFilter.MaxSize[0]=8191",
            "table.VideoAnalyseRule[0][0].Config.SizeFilter.MaxSize[1]=8191",
            "table.VideoAnalyseRule[0][0].Config.DetectRegion[0][0]=0",
            "table.VideoAnalyseRule[0][0].Config.DetectRegion[0][1]=0",
            "table.VideoAnalyseRule[0][0].Config.DetectRegion[1][0]=8191",
            "table.VideoAnalyseRule[0][0].Config.DetectRegion[1][1]=8191"
        ].join("\n");

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query({ action: "getConfig", name: "VideoAnalyseRule" })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        const coordinates = await device.getInvasionAreaCoordinates();

        expect(coordinates).to.deep.equal([
            { x: 0, y: 0 },
            { x: 1, y: 1 }
        ]);
    });

    it("throws MissingConfigurationError when area invasion rule is absent", async () => {
        const payload = [
            "table.VideoAnalyseRule[0][0].Class=Normal",
            "table.VideoAnalyseRule[0][0].Type=Tripwire"
        ].join("\n");

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query({ action: "getConfig", name: "VideoAnalyseRule" })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.getInvasionAreaCoordinates();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it("converts normalized coordinates and sends addConfig request", async () => {
        const payload = [
            "table.VideoAnalyseRule[0][0].Class=Normal",
            "table.VideoAnalyseRule[0][0].Type=CrossRegionDetection",
            "table.VideoAnalyseRule[0][0].Config.SizeFilter.MaxSize[0]=100",
            "table.VideoAnalyseRule[0][0].Config.SizeFilter.MaxSize[1]=200"
        ].join("\n");

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query({ action: "getConfig", name: "VideoAnalyseRule" })
            .reply(200, payload);

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query({
                action: "addConfig",
                "VideoAnalyseRule[0][0].Config.DetectRegion[0][0]": "50",
                "VideoAnalyseRule[0][0].Config.DetectRegion[0][1]": "100",
                "VideoAnalyseRule[0][0].Config.DetectRegion[1][0]": "100",
                "VideoAnalyseRule[0][0].Config.DetectRegion[1][1]": "0"
            })
            .reply(200, "OK");

        const device = new DahuaDevice(defaultConfig);

        await device.setInvasionAreaCoordinates([
            { x: 0.5, y: 0.5 },
            { x: 1, y: 0 }
        ]);
    });

    it("throws HttpRequestError when getConfig fails", async () => {
        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query({ action: "getConfig", name: "VideoAnalyseRule" })
            .reply(500, "error");

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.getInvasionAreaCoordinates();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });

    it("updates image quality configuration for all channels", async () => {
        const payload = [
            "Encode[0].MainFormat[0].Video.Compression=H.264",
            "Encode[0].MainFormat[0].Video.FPS=15",
            "Encode[0].MainFormat[0].Video.Width=1280",
            "Encode[0].MainFormat[0].Video.Height=720",
            "Encode[0].MainFormat[0].Video.Bitrate=1024",
            "Encode[0].SnapFormat[0].Video.Quality=1",
            "table.Encode[0].SnapFormat[0].Video.QualityRange=6",
            "Encode[0].MainFormat[1].Video.Compression=H.264",
            "Encode[0].MainFormat[1].Video.FPS=15",
            "Encode[0].MainFormat[1].Video.Width=1280",
            "Encode[0].MainFormat[1].Video.Height=720",
            "Encode[0].MainFormat[1].Video.Bitrate=1024",
            "Encode[0].SnapFormat[1].Video.Quality=1",
            "table.Encode[0].SnapFormat[1].Video.QualityRange=6",
            "Encode[0].MainFormat[2].Video.Compression=H.264",
            "Encode[0].MainFormat[2].Video.FPS=15",
            "Encode[0].MainFormat[2].Video.Width=1280",
            "Encode[0].MainFormat[2].Video.Height=720",
            "Encode[0].MainFormat[2].Video.Bitrate=1024",
            "Encode[0].SnapFormat[2].Video.Quality=1",
            "table.Encode[0].SnapFormat[2].Video.QualityRange=6",
            "Encode[0].MainFormat[3].Video.Compression=H.264",
            "Encode[0].MainFormat[3].Video.FPS=15",
            "Encode[0].MainFormat[3].Video.Width=1280",
            "Encode[0].MainFormat[3].Video.Height=720",
            "Encode[0].MainFormat[3].Video.Bitrate=1024",
            "Encode[0].SnapFormat[3].Video.Quality=1",
            "table.Encode[0].SnapFormat[3].Video.QualityRange=6"
        ].join("\n");

        const expectedQuery: Record<string, string> = {
            action: "setConfig",
            "Encode[0].MainFormat[0].Video.Compression": "H.265",
            "Encode[0].MainFormat[0].Video.FPS": "30",
            "Encode[0].MainFormat[0].Video.Width": "1920",
            "Encode[0].MainFormat[0].Video.Height": "1080",
            "Encode[0].MainFormat[0].Video.Bitrate": "2048",
            "Encode[0].SnapFormat[0].Video.Quality": "3",
            "Encode[0].MainFormat[1].Video.Compression": "H.265",
            "Encode[0].MainFormat[1].Video.FPS": "30",
            "Encode[0].MainFormat[1].Video.Width": "1920",
            "Encode[0].MainFormat[1].Video.Height": "1080",
            "Encode[0].MainFormat[1].Video.Bitrate": "2048",
            "Encode[0].SnapFormat[1].Video.Quality": "3",
            "Encode[0].MainFormat[2].Video.Compression": "H.265",
            "Encode[0].MainFormat[2].Video.FPS": "30",
            "Encode[0].MainFormat[2].Video.Width": "1920",
            "Encode[0].MainFormat[2].Video.Height": "1080",
            "Encode[0].MainFormat[2].Video.Bitrate": "2048",
            "Encode[0].SnapFormat[2].Video.Quality": "3",
            "Encode[0].MainFormat[3].Video.Compression": "H.265",
            "Encode[0].MainFormat[3].Video.FPS": "30",
            "Encode[0].MainFormat[3].Video.Width": "1920",
            "Encode[0].MainFormat[3].Video.Height": "1080",
            "Encode[0].MainFormat[3].Video.Bitrate": "2048",
            "Encode[0].SnapFormat[3].Video.Quality": "3"
        };

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query({ action: "getConfig", name: "Encode" })
            .reply(200, payload);

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query(expectedQuery)
            .reply(200, "OK");

        const device = new DahuaDevice(defaultConfig);

        await device.setImageQualityConfiguration({
            compression: "h265",
            fps: 30,
            resolution: {
                width: 1920,
                height: 1080
            },
            bitrate: {
                constant: 2048
            },
            shotQuality: "medium"
        });
    });

    it("does not call setConfig when image quality is already up to date", async () => {
        const payload = [
            "Encode[0].MainFormat[0].Video.Compression=H.265",
            "Encode[0].MainFormat[0].Video.FPS=30",
            "Encode[0].MainFormat[0].Video.Width=1920",
            "Encode[0].MainFormat[0].Video.Height=1080",
            "Encode[0].MainFormat[0].Video.Bitrate=2048",
            "Encode[0].SnapFormat[0].Video.Quality=3",
            "table.Encode[0].SnapFormat[0].Video.QualityRange=6",
            "Encode[0].MainFormat[1].Video.Compression=H.265",
            "Encode[0].MainFormat[1].Video.FPS=30",
            "Encode[0].MainFormat[1].Video.Width=1920",
            "Encode[0].MainFormat[1].Video.Height=1080",
            "Encode[0].MainFormat[1].Video.Bitrate=2048",
            "Encode[0].SnapFormat[1].Video.Quality=3",
            "table.Encode[0].SnapFormat[1].Video.QualityRange=6",
            "Encode[0].MainFormat[2].Video.Compression=H.265",
            "Encode[0].MainFormat[2].Video.FPS=30",
            "Encode[0].MainFormat[2].Video.Width=1920",
            "Encode[0].MainFormat[2].Video.Height=1080",
            "Encode[0].MainFormat[2].Video.Bitrate=2048",
            "Encode[0].SnapFormat[2].Video.Quality=3",
            "table.Encode[0].SnapFormat[2].Video.QualityRange=6",
            "Encode[0].MainFormat[3].Video.Compression=H.265",
            "Encode[0].MainFormat[3].Video.FPS=30",
            "Encode[0].MainFormat[3].Video.Width=1920",
            "Encode[0].MainFormat[3].Video.Height=1080",
            "Encode[0].MainFormat[3].Video.Bitrate=2048",
            "Encode[0].SnapFormat[3].Video.Quality=3",
            "table.Encode[0].SnapFormat[3].Video.QualityRange=6"
        ].join("\n");

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query({ action: "getConfig", name: "Encode" })
            .reply(200, payload);

        const device = new DahuaDevice(defaultConfig);

        await device.setImageQualityConfiguration({
            compression: "h265",
            fps: 30,
            resolution: {
                width: 1920,
                height: 1080
            },
            bitrate: {
                constant: 2048
            },
            shotQuality: "medium"
        });
    });

    it("throws HttpRequestError when setConfig returns non-ok response", async () => {
        const payload = [
            "Encode[0].MainFormat[0].Video.Compression=H.264",
            "Encode[0].MainFormat[0].Video.FPS=15",
            "Encode[0].MainFormat[0].Video.Width=1280",
            "Encode[0].MainFormat[0].Video.Height=720",
            "Encode[0].MainFormat[0].Video.Bitrate=1024",
            "Encode[0].SnapFormat[0].Video.Quality=1",
            "table.Encode[0].SnapFormat[0].Video.QualityRange=6"
        ].join("\n");

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query({ action: "getConfig", name: "Encode" })
            .reply(200, payload);

        nock("http://camera.test:80")
            .get("/cgi-bin/configManager.cgi")
            .query((queryObject) => queryObject.action === "setConfig")
            .reply(200, "error");

        const device = new DahuaDevice(defaultConfig);

        try {
            await device.setImageQualityConfiguration({
                compression: "h265",
                fps: 30,
                resolution: {
                    width: 1920,
                    height: 1080
                },
                bitrate: {
                    constant: 2048
                },
                shotQuality: "medium"
            });
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });
});

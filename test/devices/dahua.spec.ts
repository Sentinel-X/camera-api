import { expect } from "chai";
import nock from "nock";
import { DahuaDevice } from "../../src/devices/dahua.js";
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
});
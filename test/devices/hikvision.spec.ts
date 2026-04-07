import { expect } from "chai";
import nock from "nock";
import { HikvisionDevice } from "../../src/devices/hikvision.js";
import { HttpRequestError, MissingConfigurationError } from "../../src/errors.js";
import { DeviceConfiguration } from "../../src/types.js";

const defaultConfig: DeviceConfiguration = {
    ipOrHttpAddress: "http://hikvision.test",
    port: 80,
    username: "admin",
    password: "password"
};

describe("HikvisionDevice", () => {
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

    it("returns normalized coordinates from field detection XML", async () => {
        const payload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>true</enabled>
        <normalizedScreenSize>
          <normalizedScreenWidth>1000</normalizedScreenWidth>
          <normalizedScreenHeight>1000</normalizedScreenHeight>
        </normalizedScreenSize>
        <FieldDetectionRegionList>
          <FieldDetectionRegion>
            <id>1</id>
            <RegionCoordinatesList>
              <RegionCoordinates><positionX>0</positionX><positionY>1000</positionY></RegionCoordinates>
              <RegionCoordinates><positionX>1000</positionX><positionY>0</positionY></RegionCoordinates>
            </RegionCoordinatesList>
          </FieldDetectionRegion>
        </FieldDetectionRegionList>
      </FieldDetection>`;

        nock("http://hikvision.test:80")
            .get("/ISAPI/Smart/FieldDetection/1")
            .reply(200, payload);

        const device = new HikvisionDevice(defaultConfig);

        const coordinates = await device.getInvasionAreaCoordinates();

        expect(coordinates).to.deep.equal([
            { x: 0, y: 0 },
            { x: 1, y: 1 }
        ]);
    });

    it("throws MissingConfigurationError when field detection is disabled", async () => {
        const payload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>false</enabled>
      </FieldDetection>`;

        nock("http://hikvision.test:80")
            .get("/ISAPI/Smart/FieldDetection/1")
            .reply(200, payload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.getInvasionAreaCoordinates();
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(MissingConfigurationError);
        }
    });

    it("updates region id=1 coordinates using converted camera values", async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>true</enabled>
        <normalizedScreenSize>
          <normalizedScreenWidth>1000</normalizedScreenWidth>
          <normalizedScreenHeight>1000</normalizedScreenHeight>
        </normalizedScreenSize>
        <FieldDetectionRegionList>
          <FieldDetectionRegion>
            <id>1</id>
            <RegionCoordinatesList>
              <RegionCoordinates><positionX>10</positionX><positionY>10</positionY></RegionCoordinates>
            </RegionCoordinatesList>
          </FieldDetectionRegion>
          <FieldDetectionRegion>
            <id>2</id>
          </FieldDetectionRegion>
        </FieldDetectionRegionList>
      </FieldDetection>`;

        const putPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>1</statusCode>
        <subStatusCode>ok</subStatusCode>
      </ResponseStatus>`;

        let putBody = "";
        nock("http://hikvision.test:80")
            .get("/ISAPI/Smart/FieldDetection/1")
            .reply(200, getPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/Smart/FieldDetection/1", (body: string) => {
                putBody = String(body);
                return true;
            })
            .reply(200, putPayload);

        const device = new HikvisionDevice(defaultConfig);

        await device.setInvasionAreaCoordinates([
            { x: 0.25, y: 0.75 },
            { x: 1, y: 0 }
        ]);

        expect(putBody).to.include("<positionX>250</positionX>");
        expect(putBody).to.include("<positionY>250</positionY>");
        expect(putBody).to.include("<positionX>1000</positionX>");
        expect(putBody).to.include("<positionY>1000</positionY>");
    });

    it("throws HttpRequestError when update response is not ok", async () => {
        const getPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <FieldDetection>
        <enabled>true</enabled>
        <normalizedScreenSize>
          <normalizedScreenWidth>1000</normalizedScreenWidth>
          <normalizedScreenHeight>1000</normalizedScreenHeight>
        </normalizedScreenSize>
        <FieldDetectionRegionList>
          <FieldDetectionRegion><id>1</id></FieldDetectionRegion>
          <FieldDetectionRegion><id>2</id></FieldDetectionRegion>
        </FieldDetectionRegionList>
      </FieldDetection>`;

        const badPutPayload = `<?xml version="1.0" encoding="UTF-8"?>
      <ResponseStatus>
        <statusCode>2</statusCode>
        <subStatusCode>error</subStatusCode>
      </ResponseStatus>`;

        nock("http://hikvision.test:80")
            .get("/ISAPI/Smart/FieldDetection/1")
            .reply(200, getPayload);

        nock("http://hikvision.test:80")
            .put("/ISAPI/Smart/FieldDetection/1")
            .reply(200, badPutPayload);

        const device = new HikvisionDevice(defaultConfig);

        try {
            await device.setInvasionAreaCoordinates([{ x: 0.1, y: 0.2 }]);
            expect.fail('Function should have thrown');
        } catch (error) {
            expect(error).to.be.instanceOf(HttpRequestError);
        }
    });
});

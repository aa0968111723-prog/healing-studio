import { describe, expect, it } from "vitest";

import {
  applyCameraMotionToPrompt,
  describeCameraMotion,
  pickCamMasterMotion,
} from "../../../shared/cameraMotionPrompt";

describe("describeCameraMotion", () => {
  it("returns null when all sliders are at rest", () => {
    expect(describeCameraMotion({ pan: 0, zoom: 0, tilt: 0 })).toBeNull();
  });

  it("ignores values inside the dead zone", () => {
    expect(describeCameraMotion({ pan: 5, zoom: -7, tilt: 9 })).toBeNull();
  });

  it("returns null for null/undefined input", () => {
    expect(describeCameraMotion(null)).toBeNull();
    expect(describeCameraMotion(undefined)).toBeNull();
  });

  it("describes a single-axis pan with direction and strength", () => {
    expect(describeCameraMotion({ pan: 80, zoom: 0, tilt: 0 })).toBe(
      "Camera motion: strong pan to the right."
    );
    expect(describeCameraMotion({ pan: -40, zoom: 0, tilt: 0 })).toBe(
      "Camera motion: moderate pan to the left."
    );
  });

  it("describes zoom as push-in / pull-out", () => {
    expect(describeCameraMotion({ pan: 0, zoom: 50, tilt: 0 })).toBe(
      "Camera motion: moderate push-in toward the subject."
    );
    expect(describeCameraMotion({ pan: 0, zoom: -25, tilt: 0 })).toBe(
      "Camera motion: slight pull-out away from the subject."
    );
  });

  it("describes tilt as upward / downward", () => {
    expect(describeCameraMotion({ pan: 0, zoom: 0, tilt: 90 })).toBe(
      "Camera motion: strong tilt upward."
    );
    expect(describeCameraMotion({ pan: 0, zoom: 0, tilt: -15 })).toBe(
      "Camera motion: slight tilt downward."
    );
  });

  it("combines multiple axes into one clause", () => {
    expect(describeCameraMotion({ pan: 60, zoom: 30, tilt: -45 })).toBe(
      "Camera motion: moderate pan to the right, slight push-in toward the subject, moderate tilt downward."
    );
  });
});

describe("applyCameraMotionToPrompt", () => {
  it("returns the original prompt unchanged when motion is empty", () => {
    expect(applyCameraMotionToPrompt("a cat in a garden", { pan: 0, zoom: 0, tilt: 0 })).toBe(
      "a cat in a garden"
    );
    expect(applyCameraMotionToPrompt("a cat in a garden", undefined)).toBe(
      "a cat in a garden"
    );
  });

  it("appends the camera clause with a single separator", () => {
    expect(applyCameraMotionToPrompt("a cat in a garden", { pan: 0, zoom: 80, tilt: 0 })).toBe(
      "a cat in a garden. Camera motion: strong push-in toward the subject."
    );
  });

  it("trims trailing punctuation before joining", () => {
    expect(
      applyCameraMotionToPrompt("a cat in a garden.", { pan: -60, zoom: 0, tilt: 0 })
    ).toBe("a cat in a garden. Camera motion: moderate pan to the left.");
    expect(
      applyCameraMotionToPrompt("貓咪在花園裡。", { pan: 60, zoom: 0, tilt: 0 })
    ).toBe("貓咪在花園裡. Camera motion: moderate pan to the right.");
  });
});

describe("pickCamMasterMotion", () => {
  it("returns null when no axis is strong enough", () => {
    expect(pickCamMasterMotion({ pan: 0, zoom: 0, tilt: 0 })).toBeNull();
    expect(pickCamMasterMotion({ pan: 5, zoom: 8, tilt: -3 })).toBeNull();
    expect(pickCamMasterMotion(null)).toBeNull();
  });

  it("picks the dominant axis", () => {
    expect(pickCamMasterMotion({ pan: 80, zoom: 20, tilt: 10 })).toBe("pan_right");
    expect(pickCamMasterMotion({ pan: -90, zoom: 0, tilt: 0 })).toBe("pan_left");
    expect(pickCamMasterMotion({ pan: 10, zoom: 50, tilt: 0 })).toBe("push_in");
    expect(pickCamMasterMotion({ pan: 0, zoom: -70, tilt: 30 })).toBe("pull_out");
    expect(pickCamMasterMotion({ pan: 0, zoom: 10, tilt: 80 })).toBe("tilt_up");
    expect(pickCamMasterMotion({ pan: 0, zoom: 0, tilt: -45 })).toBe("tilt_down");
  });
});

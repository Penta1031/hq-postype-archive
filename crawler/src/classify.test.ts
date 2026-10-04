import assert from "node:assert/strict";
import { inferSeriesFromTitle } from "./series.js";
import { adultStatusFromSerialized } from "./postype.js";

const cases = [
  ["폭망(I Like You) 上", "폭망(I Like You)", "上", "연재중"],
  ["폭망(I Like You) 中", "폭망(I Like You)", "中", "연재중"],
  ["[혀쾌] 4242 下", "4242", "下", "완결"],
  ["이별뒤에도, 3", "이별뒤에도", "3", "연재중"],
  ["fateful [1]", "fateful", "1", "연재중"],
  ["미완3", "미완", "3", "연재중"],
  ["햇살이 온다 10 (完)", "햇살이 온다", "10", "완결"],
] as const;

for (const [title, seriesName, seriesVolume, serializationStatus] of cases) {
  assert.deepEqual(inferSeriesFromTitle(title), {
    isSeries: true,
    seriesName,
    seriesVolume,
    serializationStatus,
    statusReason: `제목의 회차 표기(${seriesVolume})를 기준으로 자동 판정`,
  });
}

for (const title of ["Run Like This", "10월 31일", "1일 1혀쾌", "혀쾌, 5피스", "4242"]) {
  assert.equal(inferSeriesFromTitle(title), null, title);
}

assert.equal(adultStatusFromSerialized('{\\"postId\\":22559538,\\"adult\\":false}', 22559538), false);
assert.equal(adultStatusFromSerialized('{\\"postId\\":22987312,\\"adult\\":true}', 22987312), true);
assert.equal(adultStatusFromSerialized('{\\"postId\\":1,\\"adult\\":true}', 2), null);

console.log("title series inference and adult status tests passed");

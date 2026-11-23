import {
    initNative, Direction, Point, nameOf, step, turnRight,
} from './native/native.h';

await initNative();

let at = await new Point();
let facing = await Direction.North;
for (let turn = 0; turn < 4; turn += 1) {
    at = await step(at, facing, 2);
    console.log(await nameOf(facing), await at.x, await at.y);
    facing = await turnRight(facing);
}

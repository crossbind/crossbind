import {
    initNative, Circle, Square, largerArea,
} from './native/native.h';

await initNative();

const circle = await new Circle(1);
const square = await new Square(2);
console.log('circle:', await circle.area());
console.log('the larger:', await largerArea(circle, square));

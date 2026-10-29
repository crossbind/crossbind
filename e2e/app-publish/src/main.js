import { initNative, Native } from './native/native.h';

const message = document.querySelector('#cppMessage');

initNative()
    .then(() => Native.greeting())
    .then((result) => {
        message.textContent = result;
    })
    .catch((error) => {
        message.textContent = error.message;
    });

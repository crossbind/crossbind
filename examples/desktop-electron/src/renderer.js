const message = document.querySelector('#cppMessage');

window.native.sample()
    .then((result) => { message.textContent = result; })
    .catch((error) => { message.textContent = error.message; });

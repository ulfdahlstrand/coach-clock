// jsdom implementerar inte scrollTo, och TanStack Router anropar den vid varje
// navigering. Stubben tystar varningen utan att dölja riktiga fel.
window.scrollTo = () => {};

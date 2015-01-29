Dropthing
=========

Drop STL files into your designated directory and watch as they magically appear
as things in the [thingiverse](http://thingiverse.com).

## Getting Started

Create a copy of `config.example.json` called `config.json` in the app directory
and modify it to include your the clientId and clientSecret you got from
registering a new app with thingiverse. Modify the other settings too to change
how your things are created.

Assuming you already have node and npm installed, install dependencies with

    npm install

and run with

	npm start

Useful stuff will be logged to the console and more stuff to a log file if you
have one configured.

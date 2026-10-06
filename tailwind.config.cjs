/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#162033",
        panel: "#f6f7fb",
      },
    },
  },
  plugins: [],
};

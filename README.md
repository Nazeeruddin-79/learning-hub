# Learning Hub MongoDB Prototype

## Stack
React + Vite frontend, Node.js + Express API, MongoDB Atlas + Mongoose. This is a local prototype suitable for demonstrating database persistence.

## Setup
1. Install Node.js (20+ recommended).
2. Extract this ZIP and open a terminal in the project folder.
3. Run `npm install` then `npm run install:all`.
4. Copy `server/.env.example` to `server/.env`.
5. In `server/.env`, set `MONGODB_URI` to your real Atlas connection string and set `JWT_SECRET` to a random secret at least 24 characters long.
6. Start with `npm run dev`.
7. Open `http://localhost:5173`.

## MongoDB URI format
`mongodb+srv://developer:YOUR_URL_ENCODED_PASSWORD@cluster0.ovi6c4z.mongodb.net/learning_hub?retryWrites=true&w=majority`

Replace the placeholder, do not keep angle brackets. URL-encode special characters in the password (`@` becomes `%40`). Never commit or share `.env`. Make sure the Atlas database user has read/write permissions and Network Access permits your current IP.

## Demo
1. Register as a tutor.
2. Add a course, then add a lecture with a public YouTube/Vimeo/MP4 URL, then create an assignment.
3. Log out and register as a student.
4. Choose the tutor in the prompt; the student's dashboard then shows that tutor's lectures and assignments.
5. In Atlas, inspect the `learning_hub` database and collections `users`, `courses`, `lectures`, `assignments`, `tutorchoices`.

Default courses are inserted into MongoDB automatically if the courses collection is empty. User passwords are bcrypt hashes, never plain text. Tutor choice, courses, lectures and assignments persist in MongoDB.

## Video note
This prototype stores the video URL and lecture metadata in MongoDB, not the actual video file bytes. Actual file storage in MongoDB would require a GridFS upload feature.

## Troubleshooting
- `bad auth`: check Atlas database username/password and URL-encode special characters.
- `IP not allowed`: add your current IP in Atlas Network Access.
- `MONGODB_URI is missing`: check `server/.env`.
- UI says API offline: confirm the backend terminal reports a successful MongoDB connection.
- Before public deployment, add rate limiting, email verification/password reset, stronger validation and production security review.

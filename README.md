# ChordCraft 🎵
🦆 GeeseHacks '25 Submission
👨‍💻 Ivy Cho, Henry Hung, Ryan Xiao, Daniel Zhao

## Inspiration
🎹 The inspiration for ChordCraft stemmed from a deep love for music and the desire to make music creation more accessible. As a team of musicians, we often struggled with transcribing melodies into sheet music quickly. We envisioned a tool that would allow users to play a virtual piano and instantly see their notes transformed into digital sheet music, making the process of composing and sharing music more intuitive and enjoyable.

## What it does
🎵 ChordCraft is an interactive web application that transforms piano key presses into digital sheet music in real-time. Key features include:
- An interactive piano keyboard that responds to user input.
- Real-time note recording that visualizes the music being played.
- A sheet music preview that updates dynamically as notes are played.
- The ability to save and clear notes for easy management of compositions.

## How we built it
⭐ The project was built using a combination of modern web technologies:
- **Frontend**: We utilized React for building the user interface, with Vite as the build tool for fast development and hot module replacement.
- **Backend**: An Express.js server running on Node.js, integrated with MongoDB for data persistence, allowing users to save and retrieve their sheet music securely.

The development process involved setting up the MERN project structure, creating MongoDB schemas for Users and Music, and implementing JWT authentication for secure data management.

## Challenges we ran into
🏃 During the development of ChordCraft, we faced several challenges:
- **Database Migration**: Moving from Firebase's NoSQL real-time structure to a custom MERN architecture required careful schema design.
- **JWT Authentication**: Implementing secure token-based authentication from scratch to manage user sessions.
- **Playing Chords**: Managing how the program responds when multiple keys are pressed at the same time was a complex task.

## Accomplishments that we're proud of
✨ We are proud of several accomplishments in the development of ChordCraft:
- Successfully migrating the backend from Firebase to a scalable MERN stack, giving us full control over our API and data.
- Creating a user-friendly interface that makes it easy for musicians of all skill levels to interact with the application.
- Implementing a responsive design that ensures a seamless experience across various devices.

## What we learned
📝 Throughout the project, we learned valuable lessons, including:
- The importance of effective state management in React applications, particularly when dealing with custom REST APIs.
- How to design and implement a full-stack MERN application with secure authentication.

## What's next for ChordCraft
🌱 Looking ahead, we plan to enhance ChordCraft with additional features, such as:
- Advanced music notation options for more complex compositions.
- Collaboration features that enable multiple users to work on the same piece of music in real-time.
- Expanding the application to support other instruments and musical styles, making it a versatile tool for all musicians.

🤩 We are excited about the future of ChordCraft and the potential it has to empower musicians in their creative journeys!
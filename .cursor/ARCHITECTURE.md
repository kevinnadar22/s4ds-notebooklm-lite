We need to build a web application that allows users to upload their own pdfs
and then extract the text from the pdf.
And store it in a local vector database.
then the user can ask questions about the pdfs and the application will return the answer based on the text in the pdfs using RAG
we will also integrate with a voice assistant to allow the user to ask questions verbally and the application will return the answer using text to speech
We have conversing mode, and quiz mode
each conversation will be a new chat session. and each chat session will be stored in the database. sqlite will be used for the database.
will use fastapi, langchain, Chroma, and google gemini for the ai model.
langsmith for monitoring and debugging.
use htmml, tailwindcss for the frontend.

the code will be simple and easy to understand and maintain. for beginner, 
this for educational purpose. no need to build the infra, 
the code should be commented well, and the structure should be easy to understand.
import streamlit as st
import requests

# App title
st.set_page_config(page_title="Group 61 - MBTI Personality Chatbot")
st.markdown("""
    <h1 style='text-align: center; color: violet;'>Group 61 - MBTI Personality Chatbot</h1>
    <h2 style='text-align: center;'>🧠 MBTI Personality Chatbot</h2>
    <p style='text-align: center;'>Chat freely with me. After a few responses, I’ll guess your MBTI personality type!</p>
""", unsafe_allow_html=True)

# Initialize chat history
if "messages" not in st.session_state:
    st.session_state["messages"] = []

# Display chat messages
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# User input
prompt = st.chat_input("Say something...")
if prompt:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            headers = {
                "Authorization": f"Bearer {st.secrets['OPENROUTER_API_KEY']}",
                "Content-Type": "application/json"
            }

            data = {
                "model": "mistralai/mixtral-8x7b-instruct",
                "messages": st.session_state.messages,
            }

            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=data
            )

            try:
                bot_msg = response.json()["choices"][0]["message"]["content"]
            except Exception as e:
                bot_msg = f"Error: {e}\n\n{response.text}"

            st.markdown(bot_msg)
            st.session_state.messages.append({"role": "assistant", "content": bot_msg})
